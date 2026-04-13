import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  GoneException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { EzeeService } from '../../ezee/ezee.service';
import { CacheService } from '../../redis/cache.service';
import { SearchColiveDto } from './dto/search-colive.dto';
import { CreateColiveQuoteDto } from './dto/create-quote.dto';
import { CreateCOliveDraftBookingDto } from './dto/create-draft-booking.dto';

// GST rate for long-stay (5% same as nightly: SGST 2.5% + CGST 2.5%)
const GST_RATE = 0.05;

// Quote TTL in minutes
const QUOTE_TTL_MINUTES = 30;

// eZee cache TTL for colive room pricing (30 minutes)
const COLIVE_RATE_CACHE_TTL = 30 * 60;

@Injectable()
export class ColiveService {
  private readonly logger = new Logger(ColiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ezee: EzeeService,
    private readonly cache: CacheService,
  ) {}

  // ── 1. SEARCH INVENTORY ────────────────────────────────────────────────────

  async searchInventory(dto: SearchColiveDto) {
    // Persist search session for analytics
    const searchId = uuidv4();
    const locationRecord = await this.prisma.colive_locations.findFirst({
      where: { slug: dto.location_slug, is_active: true },
    });

    void this.prisma.colive_search_sessions
      .create({
        data: {
          id: searchId,
          location_id: locationRecord?.id ?? null,
          location_slug: dto.location_slug,
          move_in_date: dto.move_in_date,
          duration_months: dto.duration_months,
          stay_type: dto.stay_type,
          guest_count: dto.guest_count ?? null,
          plan_id: dto.selected_plan_id ?? null,
          currency: dto.currency ?? 'INR',
        },
      })
      .catch((err) => this.logger.warn(`Search session persist failed: ${err.message}`));

    // Fetch active property content for this location
    const contents = await this.prisma.colive_property_content.findMany({
      where: {
        location_id: locationRecord?.id,
        is_active: true,
      },
      include: { properties: true },
    });

    // For each property, fetch live eZee pricing for the date range
    const moveIn = new Date(dto.move_in_date);
    const moveOut = this.addMonths(moveIn, dto.duration_months);
    const checkinStr = this.formatDate(moveIn);
    const checkoutStr = this.formatDate(moveOut);

    const propertyCards = await Promise.all(
      contents.map(async (content) => {
        const roomOptions = await this.prisma.colive_room_options.findMany({
          where: { property_id: content.property_id, is_active: true },
          include: { room_types: true },
          orderBy: { sort_order: 'asc' },
        });

        // Fetch eZee pricing with Redis caching
        const rates = await this.getEzeePricing(content.property_id, checkinStr, checkoutStr);
        const totalNights = this.calcNights(moveIn, moveOut);

        // Build a map of eZee roomTypeId → rate data for O(1) lookup
        const rateMap = new Map(rates.map((r) => [r.roomTypeId, r]));

        // Find cheapest room option price (across all options, not just available ones)
        let priceFrom = Infinity;
        let strikeFrom: number | undefined;

        for (const opt of roomOptions) {
          const ezeeId = opt.room_types.ezee_room_type_id;
          const ezeeRoom = ezeeId ? rateMap.get(ezeeId) : undefined;
          // Use eZee rate if available; fall back to DB base price for catalog display
          const ratePerNight = ezeeRoom?.ratePerNight ?? Number(opt.room_types.base_price_per_night);
          if (ratePerNight > 0) {
            const monthly = ratePerNight * 30;
            if (monthly < priceFrom) {
              priceFrom = monthly;
              const strikeMonthly = Number(opt.room_types.base_price_per_night) * 30;
              if (strikeMonthly > monthly) strikeFrom = strikeMonthly;
            }
          }
        }

        // Overall inventory state — base on minimum availability across room options
        // Rooms not returned by eZee (sold out on this window) → availability = 0
        const availabilities = roomOptions.map((opt) => {
          const ezeeId = opt.room_types.ezee_room_type_id;
          return ezeeId ? (rateMap.get(ezeeId)?.availability ?? 0) : 0;
        });
        const minAvail = availabilities.length > 0 ? Math.min(...availabilities) : 0;
        const inventoryState = this.calcInventoryState(minAvail);

        // Apply couple/remote filter
        const filteredOptions = roomOptions.filter((opt) => {
          const recommended = (opt.recommended_for as string[]) ?? [];
          if (dto.stay_type === 'couple') {
            return (opt.max_guests ?? 1) >= 2;
          }
          if (dto.stay_type === 'remote') {
            return recommended.includes('remote') || recommended.length === 0;
          }
          return true;
        });

        if (filteredOptions.length === 0) return null; // no rooms for this stay_type

        // Update result count on session (fire and forget)
        void this.prisma.colive_search_sessions
          .update({
            where: { id: searchId },
            data: { result_count: contents.length },
          })
          .catch(() => {});

        return {
          property_id: content.property_id,
          slug: content.slug,
          name: content.properties.name,
          city_label: content.properties.city,
          microcopy: content.microcopy ?? '',
          hero_image_url: content.hero_image_url ?? '',
          secondary_image_url: content.secondary_image_url ?? undefined,
          price_from_monthly: priceFrom === Infinity ? 0 : Math.round(priceFrom),
          strike_price_from_monthly: strikeFrom,
          rating: content.rating ? Number(content.rating) : undefined,
          rating_label: content.rating_label ?? undefined,
          primary_tag: content.primary_tag ?? '',
          secondary_tag: content.secondary_tag ?? undefined,
          amenities: (content.amenities as string[]) ?? [],
          inventory_state: inventoryState,
          inventory_message: this.inventoryMessage(minAvail),
          recommended_for: (content.recommended_for as string[]) ?? [],
        };
      }),
    );

    return {
      search_id: searchId,
      location: {
        id: locationRecord?.id ?? dto.location_id,
        slug: dto.location_slug,
        label: locationRecord?.label ?? dto.location_slug,
      },
      move_in_date: dto.move_in_date,
      duration_months: dto.duration_months,
      stay_type: dto.stay_type,
      properties: propertyCards.filter(Boolean),
    };
  }

  // ── 2. PROPERTY DETAIL ─────────────────────────────────────────────────────

  async getPropertyDetail(
    propertyId: string,
    moveInDate: string,
    durationMonths: number,
    stayType: string,
  ) {
    const content = await this.prisma.colive_property_content.findFirst({
      where: { property_id: propertyId, is_active: true },
      include: { properties: true },
    });

    if (!content) {
      throw new NotFoundException(`No colive content found for property ${propertyId}`);
    }

    const moveIn = new Date(moveInDate);
    const moveOut = this.addMonths(moveIn, durationMonths);
    const checkinStr = this.formatDate(moveIn);
    const checkoutStr = this.formatDate(moveOut);

    const rates = await this.getEzeePricing(propertyId, checkinStr, checkoutStr);

    const roomOptions = await this.prisma.colive_room_options.findMany({
      where: { property_id: propertyId, is_active: true },
      include: { room_types: true },
      orderBy: { sort_order: 'asc' },
    });

    const roomOptionCards = roomOptions.map((opt) => {
      const ezeeRoom = rates.find((r) => r.roomTypeId === opt.room_types.ezee_room_type_id);
      const ratePerNight = ezeeRoom?.ratePerNight ?? Number(opt.room_types.base_price_per_night);
      const monthlyPrice = Math.round(ratePerNight * 30);
      const strikeMonthly = Math.round(Number(opt.room_types.base_price_per_night) * 30);
      const availableUnits = ezeeRoom?.availability ?? 0;

      // Couple filter
      if (stayType === 'couple' && (opt.max_guests ?? 1) < 2) return null;

      return {
        room_type_id: opt.room_type_id,
        slug: opt.slug,
        name: opt.name,
        description: opt.description ?? '',
        monthly_price: monthlyPrice,
        strike_monthly_price: strikeMonthly > monthlyPrice ? strikeMonthly : undefined,
        available_units: availableUnits,
        inventory_message: this.inventoryMessage(availableUnits),
        feature_points: (opt.feature_points as string[]) ?? [],
        max_guests: opt.max_guests ?? 1,
        recommended_for: (opt.recommended_for as string[]) ?? [],
        thumbnail_url: opt.thumbnail_url ?? undefined,
      };
    });

    return {
      property_id: propertyId,
      slug: content.slug,
      name: content.properties.name,
      city_label: content.properties.city,
      headline: content.headline ?? undefined,
      subheadline: content.subheadline ?? undefined,
      description: content.description ?? '',
      hero_gallery: {
        main_image_url: content.hero_image_url ?? '',
        supporting_image_urls: (content.supporting_image_urls as string[]) ?? [],
        gallery_count: content.gallery_count ?? undefined,
      },
      tags: {
        primary: content.primary_tag ?? '',
        secondary: content.secondary_tag ?? undefined,
      },
      benefits: (content.benefits as any[]) ?? [],
      room_options: roomOptionCards.filter(Boolean),
      stories: (content.stories as any[]) ?? [],
      pricing_defaults: {
        move_in_date: moveInDate,
        duration_months: durationMonths,
        stay_type: stayType,
      },
      checkout_notes: (content.checkout_notes as string[]) ?? [],
    };
  }

  // ── 3. ADDON CATALOG ────────────────────────────────────────────────────────

  async getAddons(propertyId: string, durationMonths?: number) {
    const addons = await this.prisma.colive_addons.findMany({
      where: { property_id: propertyId, is_active: true },
      orderBy: { sort_order: 'asc' },
    });

    return {
      property_id: propertyId,
      addons: addons.map((a) => ({
        addon_id: a.id,
        slug: a.slug,
        name: a.name,
        description: a.description ?? '',
        pricing_model: a.pricing_model as 'per_month' | 'one_time',
        unit_price: Number(a.unit_price),
        currency: a.currency,
        max_quantity: a.max_quantity ?? undefined,
        default_quantity: a.default_quantity ?? 0,
        is_available: a.is_available,
        availability_message: a.availability_message ?? undefined,
        category: a.category ?? undefined,
        icon_hint: a.icon_hint ?? undefined,
      })),
    };
  }

  // ── 4. QUOTE ───────────────────────────────────────────────────────────────

  async createQuote(dto: CreateColiveQuoteDto, guestId?: string) {
    // Verify property
    const property = await this.prisma.properties.findUnique({
      where: { id: dto.property_id },
    });
    if (!property) throw new NotFoundException('Property not found');

    // Find room option for this room_type + property
    const roomOption = await this.prisma.colive_room_options.findFirst({
      where: { property_id: dto.property_id, room_type_id: dto.room_type_id, is_active: true },
      include: { room_types: true },
    });
    if (!roomOption) throw new NotFoundException('Room option not found for this property');

    // Fetch live eZee pricing
    const moveIn = new Date(dto.move_in_date);
    const moveOut = this.addMonths(moveIn, dto.duration_months);
    const checkinStr = this.formatDate(moveIn);
    const checkoutStr = this.formatDate(moveOut);
    const totalNights = this.calcNights(moveIn, moveOut);

    const rates = await this.getEzeePricing(dto.property_id, checkinStr, checkoutStr);
    const ezeeRoom = rates.find((r) => r.roomTypeId === roomOption.room_types.ezee_room_type_id);

    // Fall back to DB base_price_per_night if eZee unavailable
    const ratePerNight = ezeeRoom?.ratePerNight ?? Number(roomOption.room_types.base_price_per_night);
    if (ratePerNight <= 0) {
      throw new BadRequestException('Could not determine room pricing from eZee');
    }

    // Compute room total (nightly rate × total nights in stay)
    const roomLineTotal = Math.round(ratePerNight * totalNights);
    const roomSubtotal = roomLineTotal;

    // Process addons
    const addonLines: any[] = [];
    let addonSubtotal = 0;

    if (dto.addons?.length > 0) {
      const addonIds = dto.addons.map((a) => a.addon_id);
      const addonRecords = await this.prisma.colive_addons.findMany({
        where: { id: { in: addonIds }, property_id: dto.property_id, is_active: true },
      });

      for (const input of dto.addons) {
        if (input.quantity === 0) continue;
        const addon = addonRecords.find((a) => a.id === input.addon_id);
        if (!addon || !addon.is_available) continue;

        const qty = Math.min(input.quantity, addon.max_quantity ?? input.quantity);
        const unitPrice = Number(addon.unit_price);
        // per_month addons are multiplied by duration; one_time are flat
        const lineTotal =
          addon.pricing_model === 'per_month'
            ? unitPrice * qty * dto.duration_months
            : unitPrice * qty;

        addonLines.push({
          addon_id: addon.id,
          name: addon.name,
          quantity: qty,
          unit_price: unitPrice,
          pricing_model: addon.pricing_model,
          line_total: lineTotal,
        });
        addonSubtotal += lineTotal;
      }
    }

    // Included items (free things bundled with stay)
    const includedItems = [
      { id: 'wifi', label: 'High-Speed WiFi', type: 'included', display_value: 'Included' },
      { id: 'housekeeping', label: 'Weekly Housekeeping', type: 'included', display_value: 'Included' },
      { id: 'deposit', label: 'Security Deposit', type: 'included', display_value: '₹0' },
    ];

    // Pricing
    const subtotal = roomSubtotal + addonSubtotal;
    const taxTotal = Math.round(subtotal * GST_RATE);
    const grandTotal = subtotal + taxTotal;

    const strikeMonthly = Math.round(Number(roomOption.room_types.base_price_per_night) * 30);
    const actualMonthly = Math.round(ratePerNight * 30);
    const monthlySavings = strikeMonthly > actualMonthly ? strikeMonthly - actualMonthly : 0;
    const totalSavings = monthlySavings > 0 ? monthlySavings * dto.duration_months : 0;

    const pricingNotes = [
      `Pricing includes ${totalNights} nights (${dto.duration_months} month${dto.duration_months > 1 ? 's' : ''})`,
      'GST @ 5% applied on room + addons',
      'No security deposit required',
    ];

    // Persist quote
    const quoteId = uuidv4();
    const expiresAt = new Date(Date.now() + QUOTE_TTL_MINUTES * 60 * 1000);

    await this.prisma.colive_quotes.create({
      data: {
        id: quoteId,
        property_id: dto.property_id,
        guest_id: guestId ?? null,
        room_option_id: roomOption.id,
        move_in_date: moveIn,
        duration_months: dto.duration_months,
        stay_type: dto.stay_type,
        room_line_total: roomLineTotal,
        addons_json: addonLines,
        included_items_json: includedItems,
        room_subtotal: roomSubtotal,
        addon_subtotal: addonSubtotal,
        discount_total: 0,
        deposit_total: 0,
        tax_total: taxTotal,
        grand_total: grandTotal,
        monthly_savings: monthlySavings,
        total_savings: totalSavings,
        pricing_notes_json: pricingNotes,
        coupon_code: dto.coupon_code ?? null,
        currency: 'INR',
        ezee_rate_per_night: ratePerNight,
        expires_at: expiresAt,
      },
    });

    return {
      quote_id: quoteId,
      currency: 'INR',
      room: {
        room_type_id: dto.room_type_id,
        name: roomOption.name,
        monthly_price: actualMonthly,
        strike_monthly_price: strikeMonthly > actualMonthly ? strikeMonthly : undefined,
        duration_months: dto.duration_months,
        line_total: roomLineTotal,
      },
      addons: addonLines,
      included_items: includedItems,
      charges: {
        room_subtotal: roomSubtotal,
        addon_subtotal: addonSubtotal,
        discount_total: 0,
        deposit_total: 0,
        tax_total: taxTotal,
        grand_total: grandTotal,
      },
      savings: {
        monthly_savings: monthlySavings,
        total_savings: totalSavings,
      },
      pricing_notes: pricingNotes,
    };
  }

  // ── 5. DRAFT BOOKING ───────────────────────────────────────────────────────

  async createDraftBooking(dto: CreateCOliveDraftBookingDto, guestId?: string) {
    // Validate quote exists and has not expired
    const quote = await this.prisma.colive_quotes.findUnique({
      where: { id: dto.quote_id },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    if (new Date() > quote.expires_at) {
      throw new GoneException('Quote has expired. Please request a new quote.');
    }

    // Validate room option
    const roomOption = await this.prisma.colive_room_options.findFirst({
      where: { property_id: dto.property_id, room_type_id: dto.room_type_id, is_active: true },
      include: { room_types: true },
    });
    if (!roomOption) throw new NotFoundException('Room option not found');

    const property = await this.prisma.properties.findUnique({
      where: { id: dto.property_id },
    });
    if (!property) throw new NotFoundException('Property not found');

    // Validate addon availability
    const addonLines: any[] = [];
    let addonSubtotal = 0;

    if (dto.addons?.length > 0) {
      const addonIds = dto.addons.filter((a) => a.quantity > 0).map((a) => a.addon_id);
      const addonRecords = await this.prisma.colive_addons.findMany({
        where: { id: { in: addonIds }, property_id: dto.property_id, is_active: true },
      });

      for (const input of dto.addons) {
        if (input.quantity === 0) continue;
        const addon = addonRecords.find((a) => a.id === input.addon_id);
        if (!addon) throw new BadRequestException(`Addon ${input.addon_id} not found`);
        if (!addon.is_available) {
          throw new BadRequestException(`Addon "${addon.name}" is currently unavailable`);
        }
        const qty = Math.min(input.quantity, addon.max_quantity ?? input.quantity);
        const unitPrice = Number(addon.unit_price);
        const lineTotal =
          addon.pricing_model === 'per_month'
            ? unitPrice * qty * dto.duration_months
            : unitPrice * qty;

        addonLines.push({
          addon_id: addon.id,
          name: addon.name,
          quantity: qty,
          unit_price: unitPrice,
          pricing_model: addon.pricing_model,
          line_total: lineTotal,
        });
        addonSubtotal += lineTotal;
      }
    }

    // Use quote charges (already computed from eZee)
    const roomSubtotal = Number(quote.room_subtotal);
    const taxTotal = Number(quote.tax_total);
    const grandTotal = roomSubtotal + addonSubtotal + taxTotal;

    // Compute estimated checkout
    const moveIn = new Date(dto.move_in_date);
    const estimatedCheckout = this.addMonths(moveIn, dto.duration_months);

    // Generate human-readable booking reference: VH-CL-YYYYMM-XXXX
    const bookingReference = this.generateBookingRef(dto.move_in_date);

    const draftId = uuidv4();

    await this.prisma.colive_draft_bookings.create({
      data: {
        id: draftId,
        booking_reference: bookingReference,
        quote_id: dto.quote_id,
        property_id: dto.property_id,
        guest_id: guestId ?? null,
        room_option_id: roomOption.id,
        room_type_id: dto.room_type_id,
        move_in_date: moveIn,
        duration_months: dto.duration_months,
        stay_type: dto.stay_type,
        estimated_checkout: estimatedCheckout,
        first_name: dto.guest_details.first_name,
        last_name: dto.guest_details.last_name,
        email: dto.guest_details.email,
        phone: dto.guest_details.phone,
        addons_json: addonLines,
        room_subtotal: roomSubtotal,
        addon_subtotal: addonSubtotal,
        tax_total: taxTotal,
        grand_total: grandTotal,
        source: dto.source ?? 'web_colive_flow',
        notes: dto.notes ?? null,
        status: 'draft',
      },
    });

    return {
      draft_booking_id: draftId,
      property_id: dto.property_id,
      property_name: property.name,
      room_type_id: dto.room_type_id,
      room_type_name: roomOption.name,
      move_in_date: dto.move_in_date,
      duration_months: dto.duration_months,
      estimated_checkout_date: this.formatDate(estimatedCheckout),
      status: 'draft',
      guest_details: dto.guest_details,
      addons: addonLines,
      charges: {
        room_subtotal: roomSubtotal,
        addon_subtotal: addonSubtotal,
        tax_total: taxTotal,
        grand_total: grandTotal,
      },
    };
  }

  // ── 6. BOOKING DETAIL ──────────────────────────────────────────────────────

  async getBookingDetail(bookingId: string, guestId?: string) {
    const draft = await this.prisma.colive_draft_bookings.findUnique({
      where: { id: bookingId },
      include: { properties: true },
    });

    if (!draft) throw new NotFoundException('Booking not found');

    // Optionally gate to the owning guest if JWT provided
    if (guestId && draft.guest_id && draft.guest_id !== guestId) {
      throw new NotFoundException('Booking not found');
    }

    const roomOption = await this.prisma.colive_room_options.findUnique({
      where: { id: draft.room_option_id },
    });

    const onboarding = (draft.onboarding_json as any) ?? {};

    return {
      booking_id: draft.id,
      booking_reference: draft.booking_reference,
      status: draft.status,
      property: {
        property_id: draft.property_id,
        name: draft.properties.name,
        city_label: draft.properties.city,
      },
      stay: {
        move_in_date: this.formatDate(draft.move_in_date),
        duration_months: draft.duration_months,
        checkout_date_estimated: draft.estimated_checkout
          ? this.formatDate(draft.estimated_checkout)
          : undefined,
        stay_type: draft.stay_type,
      },
      room: {
        room_type_id: draft.room_type_id,
        name: roomOption?.name ?? '',
      },
      guest_details: {
        first_name: draft.first_name,
        last_name: draft.last_name,
        email: draft.email,
        phone: draft.phone,
      },
      addons: (draft.addons_json as any[]) ?? [],
      charges: {
        room_subtotal: Number(draft.room_subtotal),
        addon_subtotal: Number(draft.addon_subtotal),
        tax_total: Number(draft.tax_total),
        grand_total: Number(draft.grand_total),
      },
      onboarding: {
        whatsapp_url: onboarding.whatsapp_url ?? undefined,
        events_url: onboarding.events_url ?? undefined,
        community_name: onboarding.community_name ?? undefined,
        next_steps: onboarding.next_steps ?? [
          'Complete your KYC before move-in',
          'Join The Daily Social WhatsApp community',
          'Download the The Daily Social app for room access',
        ],
      },
    };
  }

  // ── HELPERS ────────────────────────────────────────────────────────────────

  /**
   * Fetch live eZee room rates + availability, cached in Redis for 30 minutes.
   * Falls back to empty array on error — callers handle gracefully.
   */
  private async getEzeePricing(
    propertyId: string,
    checkin: string,
    checkout: string,
  ): Promise<Array<{ roomTypeId: string; availability: number; ratePerNight: number }>> {
    const cacheKey = `colive:rates:${propertyId}:${checkin}:${checkout}`;
    const cached = await this.cache.get<any[]>(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.ezee.getRoomInventory(propertyId, checkin, checkout);
      const rates = result.rooms.map((r) => ({
        roomTypeId: r.roomTypeId,
        availability: r.availability,
        ratePerNight: r.ratePerNight,
      }));
      await this.cache.set(cacheKey, rates, COLIVE_RATE_CACHE_TTL);
      return rates;
    } catch (err) {
      this.logger.warn(`eZee pricing fetch failed for ${propertyId}: ${(err as Error).message}`);
      return [];
    }
  }

  private calcInventoryState(
    available: number,
  ): 'available' | 'limited' | 'waitlist' | 'sold_out' {
    if (!isFinite(available) || available <= 0) return 'sold_out';
    if (available <= 2) return 'limited';
    return 'available';
  }

  private inventoryMessage(available: number): string | undefined {
    if (!isFinite(available) || available <= 0) return 'Currently unavailable';
    if (available <= 2) return `Only ${available} left — book fast`;
    return undefined;
  }

  /** Add N calendar months to a date */
  private addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private calcNights(checkin: Date, checkout: Date): number {
    const ms = checkout.getTime() - checkin.getTime();
    return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }

  /** Generate a unique colive booking reference: VH-CL-YYYYMM-XXXX */
  private generateBookingRef(moveInDate: string): string {
    const d = new Date(moveInDate);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `TDS-CL-${ym}-${rand}`;
  }
}
