import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';
import { EzeeService } from '../../ezee/ezee.service';
import { v4 as uuidv4 } from 'uuid';
import type { CreateBookingOrderDto } from './dto/create-booking-order.dto';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ValidatedRoom {
  roomType: {
    id: string;
    name: string;
    base_price_per_night: number;
    ezee_room_type_id: string | null;
    ezee_rate_plan_id: string | null;
    ezee_rate_type_id: string | null;
  };
  quantity: number;
  lineTotal: number;
  guests?: { first_name: string; last_name: string; gender?: string }[];
}

interface ValidatedAddon {
  product: { id: string; name: string; category: string; base_price: number };
  quantity: number;
  lineTotal: number;
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class GuestBookingService {
  private readonly logger = new Logger(GuestBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly ezee: EzeeService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOKUP BOOKING (public, no auth — booking preview by ERI)
  // ═══════════════════════════════════════════════════════════════════════════

  async lookupBooking(bookingId: string) {
    const booking = await this.prisma.ezee_booking_cache.findFirst({
      where: { ezee_reservation_id: bookingId, is_active: true },
      include: { properties: { select: { name: true } } },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Intentionally exclude booker_email and booker_phone — this endpoint is public
    return {
      found: true,
      booking_id: booking.ezee_reservation_id,
      property_name: booking.properties?.name ?? 'The Daily Social',
      checkin_date: booking.checkin_date,
      checkout_date: booking.checkout_date,
      room_type_name: booking.room_type_name,
      status: booking.status,
      source: booking.source,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LINK BOOKING (existing ERI → guest)
  // ═══════════════════════════════════════════════════════════════════════════

  async linkBooking(guestId: string, eri: string) {
    const booking = await this.findBookingOrThrow(eri);

    // Already linked?
    const existingAccess = await this.prisma.booking_guest_access.findFirst({
      where: { ezee_reservation_id: eri, guest_id: guestId },
    });

    if (existingAccess) {
      const slots = await this.ensureSlots(eri, guestId, booking.no_of_guests ?? 1);
      return {
        message: 'Already linked to this booking',
        access: { role: existingAccess.role, status: existingAccess.status },
        booking: this.formatBooking(booking),
        slots: slots.map(this.formatSlot),
      };
    }

    // Determine role
    const guest = await this.prisma.guests.findUnique({
      where: { id: guestId },
      select: { email: true, phone: true },
    });

    const isBookerMatch =
      (guest?.email && guest.email === booking.booker_email) ||
      (guest?.phone && guest.phone === booking.booker_phone);

    const role = isBookerMatch ? 'PRIMARY' : 'SECONDARY';

    // Create access
    const access = await this.prisma.booking_guest_access.create({
      data: {
        id: uuidv4(),
        ezee_reservation_id: eri,
        guest_id: guestId,
        role,
        status: 'APPROVED',
        approved_by_guest_id: guestId,
        approved_at: new Date(),
      },
    });

    this.logger.log(`Guest ${guestId} linked to ${eri} as ${role}`);

    // Ensure slots exist and assign guest to first unassigned
    const slots = await this.ensureSlots(eri, guestId, booking.no_of_guests ?? 1);

    return {
      message: `Successfully linked as ${role}`,
      access: { role: access.role, status: access.status },
      booking: this.formatBooking(booking),
      slots: slots.map(this.formatSlot),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MY BOOKINGS
  // ═══════════════════════════════════════════════════════════════════════════

  async getMyBookings(guestId: string) {
    const accesses = await this.prisma.booking_guest_access.findMany({
      where: { guest_id: guestId, status: 'APPROVED' },
      include: { ezee_booking_cache: true },
      orderBy: { created_at: 'desc' },
    });

    return Promise.all(
      accesses.map(async (access) => {
        const booking = access.ezee_booking_cache;
        const slots = await this.prisma.booking_slots.findMany({
          where: { ezee_reservation_id: access.ezee_reservation_id },
        });

        return {
          ezee_reservation_id: access.ezee_reservation_id,
          role: access.role,
          status: access.status,
          room_type_name: booking.room_type_name,
          room_number: booking.room_number,
          checkin_date: booking.checkin_date,
          checkout_date: booking.checkout_date,
          property_id: booking.property_id,
          source: booking.source,
          total_slots: slots.length,
          kyc_completed_slots: slots.filter(
            (s) => s.kyc_status === 'PRE_VERIFIED' || s.kyc_status === 'VERIFIED',
          ).length,
        };
      }),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROOM CATALOG  (no dates — all rooms regardless of availability)
  // Used by: GET /guest/booking/rooms?property_id=...
  // Frontend use: homepage room listing, before user selects dates
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Returns all active room types for a property — no date filter.
   * Source: eZee Vacation Rental ‘get_rooms’ API (all rooms unconditionally),
   * enriched with base prices, amenities, and descriptions from local DB.
   *
   * Use this for the homepage catalog / room listing page.
   * Use getRoomAvailability() when the guest has selected specific dates.
   */
  async getRoomCatalog(propertyId: string) {
    const cacheKey = CacheService.catalogKey(propertyId);
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) {
      this.logger.debug(`Room catalog cache hit: ${cacheKey}`);
      return cached;
    }

    // ── eZee is source of truth for what room types exist ────────────────
    let ezeeRooms: { roomId: string; roomName: string; physicalRoomNos: string[] }[] = [];
    try {
      const catalog = await this.ezee.getPhysicalRooms(propertyId);
      ezeeRooms = catalog.rooms;
      this.logger.debug(`eZee get_rooms: ${catalog.rooms.length} room type(s)`);
    } catch (err) {
      this.logger.warn(`eZee get_rooms unavailable, falling back to DB: ${(err as Error).message}`);
    }

    // ── DB provides enrichment (slugs, amenities, pricing, type) ─────────
    // Explicit select keeps this safe if colive_price_month hasn't been migrated yet.
    const dbRoomTypes = await this.prisma.room_types.findMany({
      where: { property_id: propertyId, is_active: true },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        beds_per_room: true,
        total_beds: true,
        base_price_per_night: true,
        floor_range: true,
        amenities: true,
        ezee_room_type_id: true,
      },
    });
    // Index DB rows by their eZee room type ID for O(1) lookup
    const dbByEzeeId = new Map(
      dbRoomTypes
        .filter((r) => r.ezee_room_type_id)
        .map((r) => [r.ezee_room_type_id as string, r]),
    );

    let roomTypes: any[];

    if (ezeeRooms.length > 0) {
      // eZee drives the list; DB enriches where a mapping exists
      roomTypes = ezeeRooms.map((ezeeRoom) => {
        const db = dbByEzeeId.get(ezeeRoom.roomId);
        const physicalCount = ezeeRoom.physicalRoomNos.length;

        if (db) {
          return {
            id: db.id,
            name: db.name,
            slug: db.slug,
            type: db.type,
            beds_per_room: db.beds_per_room,
            total_beds: db.total_beds,
            base_price_per_night: Number(db.base_price_per_night),
            floor_range: db.floor_range ?? undefined,
            amenities: (db.amenities as string[]) ?? [],
            ezee_room_type_id: ezeeRoom.roomId,
            physical_room_count: physicalCount,
            bookable_online: true,
            source: 'db',
          };
        }

        // eZee room with no DB enrichment — shown but not online-bookable
        const nameLower = ezeeRoom.roomName.toLowerCase();
        return {
          id: ezeeRoom.roomId,
          name: ezeeRoom.roomName,
          slug: nameLower.replace(/\s+/g, '-'),
          type: nameLower.includes('dorm') ? 'DORM' : 'PRIVATE',
          beds_per_room: null,
          total_beds: physicalCount,
          base_price_per_night: null,
          floor_range: null,
          amenities: [],
          ezee_room_type_id: ezeeRoom.roomId,
          physical_room_count: physicalCount,
          bookable_online: false,
          source: 'ezee_only',
        };
      });
      // Sort: DB-enriched (with price) first, ascending price; unenriched last
      roomTypes.sort((a, b) => {
        if (a.base_price_per_night === null) return 1;
        if (b.base_price_per_night === null) return -1;
        return a.base_price_per_night - b.base_price_per_night;
      });
    } else if (dbRoomTypes.length > 0) {
      // eZee unreachable — serve from DB only, no physical counts
      this.logger.warn(`eZee unreachable for property ${propertyId}, serving DB catalog`);
      roomTypes = dbRoomTypes
        .sort((a, b) => Number(a.base_price_per_night) - Number(b.base_price_per_night))
        .map((rt) => ({
          id: rt.id,
          name: rt.name,
          slug: rt.slug,
          type: rt.type,
          beds_per_room: rt.beds_per_room,
          total_beds: rt.total_beds,
          base_price_per_night: Number(rt.base_price_per_night),
          floor_range: rt.floor_range ?? undefined,
          amenities: (rt.amenities as string[]) ?? [],
          ezee_room_type_id: rt.ezee_room_type_id,
          physical_room_count: null,
          bookable_online: true,
          source: 'db_fallback',
        }));
    } else {
      throw new NotFoundException('No room types found for this property');
    }

    const result = { property_id: propertyId, room_types: roomTypes };
    await this.cache.set(cacheKey, result, CacheService.TTL_CATALOG);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROOM AVAILABILITY  (dates required — live counts + rates for booking step)
  // Used by: GET /guest/booking/availability?property_id=...&checkin=...&checkout=...
  // Frontend use: date picker confirmed, before payment
  // ═══════════════════════════════════════════════════════════════════════════

  async getRoomAvailability(propertyId: string, checkinDate: string, checkoutDate: string) {
    // Check cache first
    const cacheKey = CacheService.roomAvailabilityKey(propertyId, checkinDate, checkoutDate);
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) {
      this.logger.debug(`Room availability cache hit: ${cacheKey}`);
      return cached;
    }

    const { noOfNights } = this.parseDateRange(checkinDate, checkoutDate);

    // ── DB enrichment map (keyed by ezee_room_type_id) ───────────────────
    // Explicit select keeps this safe if colive_price_month hasn't migrated yet.
    const dbRoomTypes = await this.prisma.room_types.findMany({
      where: { property_id: propertyId, is_active: true },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        total_beds: true,
        base_price_per_night: true,
        floor_range: true,
        amenities: true,
        ezee_room_type_id: true,
        ezee_rate_plan_id: true,
        ezee_rate_type_id: true,
      },
    });
    const dbByEzeeId = new Map(
      dbRoomTypes
        .filter((r) => r.ezee_room_type_id)
        .map((r) => [r.ezee_room_type_id as string, r]),
    );

    // ── eZee: live rates and availability — source of truth ───────────────
    let ezeeInventory: { roomTypeId: string; roomTypeName: string; availability: number; ratePerNight: number; ratePlanId: string; rateTypeId: string }[] = [];
    let availabilitySource: 'ezee_live' | 'local_db_estimate' = 'ezee_live';

    try {
      const inventory = await this.ezee.getRoomInventory(propertyId, checkinDate, checkoutDate);
      ezeeInventory = inventory.rooms;
      this.logger.debug(
        `eZee RoomList: ${inventory.rooms.length} type(s) for ${checkinDate}→${checkoutDate}`,
      );
    } catch (err) {
      availabilitySource = 'local_db_estimate';
      this.logger.warn(`eZee unavailable, falling back to DB estimate: ${(err as Error).message}`);
    }

    let resultRoomTypes: any[];

    if (ezeeInventory.length > 0) {
      // ── eZee drives the list; DB enriches where a mapping exists ────────
      resultRoomTypes = ezeeInventory.map((room) => {
        const db = dbByEzeeId.get(room.roomTypeId);
        const available = room.availability;
        // || not ?? — eZee returns 0 for unconfigured rate plans, fall back to DB price
        const ratePerNight = room.ratePerNight || (db ? Number(db.base_price_per_night) : 0);
        const nameLower = room.roomTypeName.toLowerCase();

        return {
          id: db?.id ?? room.roomTypeId,
          name: db?.name ?? room.roomTypeName,
          slug: db?.slug ?? nameLower.replace(/\s+/g, '-'),
          type: db?.type ?? (nameLower.includes('dorm') ? 'DORM' : 'PRIVATE'),
          available_beds: available,
          inventory_state: available <= 0 ? 'sold_out' : available <= 2 ? 'limited' : 'available',
          base_price_per_night: ratePerNight,
          total_price: ratePerNight * noOfNights,
          amenities: (db?.amenities as string[]) ?? [],
          floor_range: db?.floor_range ?? undefined,
          ezee_room_type_id: room.roomTypeId,
          ezee_rate_plan_id: room.ratePlanId || db?.ezee_rate_plan_id,
          ezee_rate_type_id: room.rateTypeId || db?.ezee_rate_type_id,
          bookable_online: !!db,
          source: db ? 'db' : 'ezee_only',
        };
      });
      // Sort: cheapest first; rooms with rate=0 last
      resultRoomTypes.sort((a, b) => {
        if (!a.base_price_per_night) return 1;
        if (!b.base_price_per_night) return -1;
        return a.base_price_per_night - b.base_price_per_night;
      });
    } else if (dbRoomTypes.length > 0) {
      // ── eZee unavailable — DB-estimated availability ─────────────────────
      const { checkin, checkout } = this.parseDateRange(checkinDate, checkoutDate);
      const bookedMap = await this.getBookedBedsMap(propertyId, checkin, checkout, dbRoomTypes);
      resultRoomTypes = dbRoomTypes
        .sort((a, b) => Number(a.base_price_per_night) - Number(b.base_price_per_night))
        .map((rt) => {
          const available = Math.max(0, rt.total_beds - (bookedMap.get(rt.id) ?? 0));
          const ratePerNight = Number(rt.base_price_per_night);
          return {
            id: rt.id,
            name: rt.name,
            slug: rt.slug,
            type: rt.type,
            available_beds: available,
            inventory_state: available <= 0 ? 'sold_out' : available <= 2 ? 'limited' : 'available',
            base_price_per_night: ratePerNight,
            total_price: ratePerNight * noOfNights,
            amenities: (rt.amenities as string[]) ?? [],
            floor_range: rt.floor_range ?? undefined,
            ezee_room_type_id: rt.ezee_room_type_id,
            ezee_rate_plan_id: rt.ezee_rate_plan_id,
            ezee_rate_type_id: rt.ezee_rate_type_id,
            bookable_online: true,
            source: 'db_fallback',
          };
        });
    } else {
      throw new NotFoundException('No room types found for this property');
    }

    const result = {
      property_id: propertyId,
      checkin_date: checkinDate,
      checkout_date: checkoutDate,
      no_of_nights: noOfNights,
      availability_source: availabilitySource,
      room_types: resultRoomTypes,
    };

    // Cache for 30 minutes
    await this.cache.set(cacheKey, result, CacheService.TTL_ROOM_AVAILABILITY);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE BOOKING ORDER
  // ═══════════════════════════════════════════════════════════════════════════

  async createBookingOrder(guestId: string, dto: CreateBookingOrderDto) {
    const { checkin, checkout, noOfNights } = this.parseDateRange(dto.checkin_date, dto.checkout_date);

    if (!dto.rooms || dto.rooms.length === 0) {
      throw new BadRequestException('At least one room selection is required');
    }

    const property = await this.prisma.properties.findUnique({ where: { id: dto.property_id } });
    if (!property) throw new NotFoundException('Property not found');

    // Invalidate cache so we get fresh availability before booking
    const cacheKey = CacheService.roomAvailabilityKey(dto.property_id, dto.checkin_date, dto.checkout_date);
    await this.cache.del(cacheKey);

    // Validate rooms (will fetch fresh data from eZee + DB)
    const availability = await this.getRoomAvailability(dto.property_id, dto.checkin_date, dto.checkout_date);
    const { validatedRooms, roomTotal, totalGuests } = this.validateRoomSelections(
      dto.rooms, availability.room_types, noOfNights,
    );

    // Validate addons
    const { validatedAddons, addonTotal } = await this.validateAddonSelections(
      dto.addons ?? [], dto.property_id,
    );

    const grandTotal = roomTotal + addonTotal;
    const eri = this.generateERI(property.city);
    const roomTypeSummary = validatedRooms.map((r) => `${r.roomType.name} x${r.quantity}`).join(', ');

    // Persist everything in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Lock addon inventory rows before reserving — prevents two concurrent create-order
      // calls for the same last unit from both passing the stock check and both decrementing.
      for (const addon of validatedAddons) {
        if (addon.product.category !== 'COMMODITY') continue;

        const locked = await tx.$queryRawUnsafe<{ available_stock: number }[]>(
          `SELECT available_stock FROM inventory
           WHERE product_id = $1 AND property_id = $2 FOR UPDATE`,
          addon.product.id,
          dto.property_id,
        );

        const available = locked[0]?.available_stock ?? 0;
        if (available < addon.quantity) {
          throw new BadRequestException(
            `"${addon.product.name}" — requested ${addon.quantity} but only ${available} available`,
          );
        }
      }

      // Reserve addon inventory
      await this.reserveAddonInventory(tx, validatedAddons, dto.property_id);

      // Create booking cache
      await tx.ezee_booking_cache.create({
        data: {
          ezee_reservation_id: eri,
          property_id: dto.property_id,
          guest_id: guestId,
          room_type_name: roomTypeSummary,
          checkin_date: checkin,
          checkout_date: checkout,
          no_of_guests: totalGuests,
          source: 'The Daily Social',
          status: 'PENDING_PAYMENT',
          is_active: true,
          fetched_at: new Date(),
          booking_rooms_json: validatedRooms.map((r) => ({
            room_type_id: r.roomType.id,
            ezee_room_type_id: r.roomType.ezee_room_type_id,
            ezee_rate_plan_id: r.roomType.ezee_rate_plan_id,
            ezee_rate_type_id: r.roomType.ezee_rate_type_id,
            quantity: r.quantity,
            price_per_night: Number(r.roomType.base_price_per_night),
            guests: r.guests ?? null,
          })),
        },
      });

      // Create guest access
      await tx.booking_guest_access.create({
        data: {
          id: uuidv4(),
          ezee_reservation_id: eri,
          guest_id: guestId,
          role: 'PRIMARY',
          status: 'APPROVED',
          approved_by_guest_id: guestId,
          approved_at: new Date(),
        },
      });

      // Create addon order if needed
      let addonOrderId: string | null = null;
      if (validatedAddons.length > 0) {
        addonOrderId = uuidv4();
        await tx.addon_orders.create({
          data: {
            id: addonOrderId,
            ezee_reservation_id: eri,
            guest_id: guestId,
            phase: 'BOOKING',
            status: 'PENDING',
          },
        });
        for (const addon of validatedAddons) {
          await tx.addon_order_items.create({
            data: {
              id: uuidv4(),
              addon_order_id: addonOrderId,
              product_id: addon.product.id,
              quantity: addon.quantity,
              unit_price: addon.product.base_price,
              total_price: addon.lineTotal,
            },
          });
        }
      }

      // Create booking slots
      await this.createBookingSlots(tx, eri, totalGuests, guestId);

      return { addonOrderId };
    });

    // Invalidate cache after booking so next caller gets fresh availability
    await this.cache.del(cacheKey);

    this.logger.log(`Booking order: ERI=${eri}, rooms=${roomTypeSummary}, total=₹${grandTotal}`);

    return {
      ezee_reservation_id: eri,
      property_id: dto.property_id,
      property_name: property.name,
      checkin_date: dto.checkin_date,
      checkout_date: dto.checkout_date,
      no_of_nights: noOfNights,
      total_guests: totalGuests,
      rooms: validatedRooms.map((r) => ({
        room_type_id: r.roomType.id,
        room_type_name: r.roomType.name,
        quantity: r.quantity,
        price_per_night: r.roomType.base_price_per_night,
        line_total: r.lineTotal,
      })),
      addons: validatedAddons.map((a) => ({
        product_id: a.product.id,
        product_name: a.product.name,
        quantity: a.quantity,
        unit_price: a.product.base_price,
        line_total: a.lineTotal,
      })),
      subtotal_rooms: roomTotal,
      subtotal_addons: addonTotal,
      grand_total: grandTotal,
      addon_order_id: result.addonOrderId,
      status: 'PENDING_PAYMENT',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROLLBACK PENDING BOOKING
  // ═══════════════════════════════════════════════════════════════════════════

  async rollbackPendingBooking(eri: string) {
    const booking = await this.prisma.ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: eri },
    });

    if (!booking || booking.status !== 'PENDING_PAYMENT') return;

    await this.prisma.$transaction(async (tx) => {
      await this.releaseAddonInventory(tx, eri, booking.property_id);
      await tx.booking_slots.deleteMany({ where: { ezee_reservation_id: eri } });
      await tx.booking_guest_access.deleteMany({ where: { ezee_reservation_id: eri } });
      await tx.ezee_booking_cache.update({
        where: { ezee_reservation_id: eri },
        data: { status: 'CANCELLED', is_active: false },
      });
    });

    this.logger.log(`Rolled back pending booking: ${eri}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIRM BOOKING (after payment)
  // ═══════════════════════════════════════════════════════════════════════════

  async confirmBooking(eri: string) {
    const booking = await this.findBookingOrThrow(eri);
    if (booking.status === 'CONFIRMED') return;

    await this.prisma.$transaction(async (tx) => {
      await tx.ezee_booking_cache.update({
        where: { ezee_reservation_id: eri },
        data: { status: 'CONFIRMED' },
      });
      await this.finalizeAddonInventory(tx, eri, booking.property_id);
    });

    this.logger.log(`Booking confirmed: ${eri}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Date parsing ─────────────────────────────────────────────────────────

  private parseDateRange(checkinDate: string, checkoutDate: string) {
    if (!checkinDate || !checkoutDate) {
      throw new BadRequestException('checkin and checkout dates are required');
    }

    const checkin = new Date(checkinDate);
    const checkout = new Date(checkoutDate);

    if (isNaN(checkin.getTime())) {
      throw new BadRequestException(`Invalid checkin date: "${checkinDate}"`);
    }
    if (isNaN(checkout.getTime())) {
      throw new BadRequestException(`Invalid checkout date: "${checkoutDate}"`);
    }
    if (checkout <= checkin) {
      throw new BadRequestException('Checkout must be after checkin');
    }

    const noOfNights = Math.ceil(
      (checkout.getTime() - checkin.getTime()) / (1000 * 60 * 60 * 24),
    );

    return { checkin, checkout, noOfNights };
  }

  // ─── Admin: cache flush ───────────────────────────────────────────────────

  /**
   * Flush all room catalog and availability cache entries for a property.
   * Called by admin endpoints after room type changes or eZee re-sync.
   */
  async flushRoomCache(propertyId: string): Promise<{ flushed: string[] }> {
    const keys = [CacheService.catalogKey(propertyId)];
    await Promise.all(keys.map((k) => this.cache.del(k)));
    this.logger.log(`Admin flushed room cache for property ${propertyId}: ${keys.join(', ')}`);
    return { flushed: keys };
  }

  // ─── ERI generation ───────────────────────────────────────────────────────

  private generateERI(propertyCity: string): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = uuidv4().slice(0, 4).toUpperCase();
    // Derive short code from city name: "Kormangala" → "KORMANGALA", "Bandra" → "BANDRA"
    const code = propertyCity.toUpperCase().replace(/\s+/g, '').slice(0, 10);
    return `TDS-${code}-${timestamp}-${random}`;
  }

  // ─── Booking lookup ───────────────────────────────────────────────────────

  private async findBookingOrThrow(eri: string) {
    const booking = await this.prisma.ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: eri },
    });
    if (!booking) {
      throw new NotFoundException(`Booking "${eri}" not found`);
    }
    return booking;
  }

  // ─── Booked beds map ──────────────────────────────────────────────────────

  private async getBookedBedsMap(
    propertyId: string, checkin: Date, checkout: Date,
    roomTypes: { id: string; name: string }[],
  ) {
    const overlapping = await this.prisma.ezee_booking_cache.findMany({
      where: {
        property_id: propertyId,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
        is_active: true,
        checkin_date: { lt: checkout },
        checkout_date: { gt: checkin },
      },
    });

    const map = new Map<string, number>();
    for (const b of overlapping) {
      const rt = roomTypes.find((r) => r.name === b.room_type_name);
      if (rt) {
        map.set(rt.id, (map.get(rt.id) ?? 0) + (b.no_of_guests ?? 1));
      }
    }
    return map;
  }

  // ─── Slots ────────────────────────────────────────────────────────────────

  private async ensureSlots(eri: string, guestId: string, numGuests: number) {
    let slots = await this.prisma.booking_slots.findMany({
      where: { ezee_reservation_id: eri },
      orderBy: { slot_number: 'asc' },
    });

    // Create if missing
    if (slots.length === 0) {
      const newSlots = Array.from({ length: numGuests }, (_, i) => ({
        id: uuidv4(),
        ezee_reservation_id: eri,
        slot_number: i + 1,
        guest_id: null as string | null,
        label: `Guest ${i + 1}`,
        kyc_status: 'NOT_STARTED',
      }));
      await this.prisma.booking_slots.createMany({ data: newSlots });
      slots = await this.prisma.booking_slots.findMany({
        where: { ezee_reservation_id: eri },
        orderBy: { slot_number: 'asc' },
      });
      this.logger.log(`Created ${numGuests} slots for ${eri}`);
    }

    // Assign guest to first unassigned slot
    const unassigned = slots.find((s) => s.guest_id === null);
    if (unassigned) {
      await this.prisma.booking_slots.update({
        where: { id: unassigned.id },
        data: { guest_id: guestId },
      });
      unassigned.guest_id = guestId;
      this.logger.log(`Assigned guest ${guestId} to slot ${unassigned.slot_number}`);
    }

    return slots;
  }

  private async createBookingSlots(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    eri: string, totalGuests: number, primaryGuestId: string,
  ) {
    for (let i = 1; i <= totalGuests; i++) {
      await tx.booking_slots.create({
        data: {
          id: uuidv4(),
          ezee_reservation_id: eri,
          slot_number: i,
          guest_id: i === 1 ? primaryGuestId : null,
          label: `Guest ${i}`,
          kyc_status: 'NOT_STARTED',
        },
      });
    }
  }

  // ─── Room validation ──────────────────────────────────────────────────────

  private validateRoomSelections(
    selections: { room_type_id: string; quantity: number; guests?: { first_name: string; last_name: string; gender?: string }[] }[],
    availableRooms: { id: string; name: string; available_beds: number; base_price_per_night: number; ezee_room_type_id: string | null; ezee_rate_plan_id: string | null; ezee_rate_type_id: string | null }[],
    noOfNights: number,
  ) {
    const totalRequested = selections.reduce((sum, s) => sum + s.quantity, 0);
    if (totalRequested > 6) {
      throw new BadRequestException('Cannot book more than 6 units in a single order');
    }

    let roomTotal = 0;
    let totalGuests = 0;
    const validatedRooms: ValidatedRoom[] = [];

    for (const sel of selections) {
      const rt = availableRooms.find((r) => r.id === sel.room_type_id);
      if (!rt) throw new NotFoundException(`Room type "${sel.room_type_id}" not found`);

      if (sel.quantity > rt.available_beds) {
        throw new BadRequestException(
          `"${rt.name}" — requested ${sel.quantity} but only ${rt.available_beds} available`,
        );
      }

      if (sel.guests && sel.guests.length !== sel.quantity) {
        throw new BadRequestException(
          `"${rt.name}" — guests array length (${sel.guests.length}) must match quantity (${sel.quantity})`,
        );
      }

      const lineTotal = rt.base_price_per_night * noOfNights * sel.quantity;
      roomTotal += lineTotal;
      totalGuests += sel.quantity;
      validatedRooms.push({ roomType: rt, quantity: sel.quantity, lineTotal, guests: sel.guests });
    }

    return { validatedRooms, roomTotal, totalGuests };
  }

  // ─── Addon validation ─────────────────────────────────────────────────────

  private async validateAddonSelections(
    addons: { product_id: string; quantity: number }[],
    propertyId: string,
  ) {
    let addonTotal = 0;
    const validatedAddons: ValidatedAddon[] = [];

    for (const addon of addons) {
      const product = await this.prisma.product_catalog.findFirst({
        where: { id: addon.product_id, property_id: propertyId, is_active: true },
      });

      if (!product) throw new NotFoundException(`Product "${addon.product_id}" not found`);
      if (product.category === 'BORROWABLE') {
        throw new BadRequestException('Borrowable items cannot be added to booking cart');
      }
      if (Number(product.base_price) === 0) {
        throw new BadRequestException(`"${product.name}" is a free service — no need to add to cart`);
      }

      // RETURNABLE items: no stock reservation at booking (allocated at check-in)
      // COMMODITY items: validate available stock now
      if (product.category === 'COMMODITY') {
        const inv = await this.prisma.inventory.findFirst({
          where: { product_id: product.id, property_id: propertyId },
        });
        if (!inv || inv.available_stock < addon.quantity) {
          throw new BadRequestException(
            `Insufficient stock for "${product.name}". Available: ${inv?.available_stock ?? 0}`,
          );
        }
      }

      const lineTotal = Number(product.base_price) * addon.quantity;
      addonTotal += lineTotal;
      validatedAddons.push({
        product: { id: product.id, name: product.name, category: product.category, base_price: Number(product.base_price) },
        quantity: addon.quantity,
        lineTotal,
      });
    }

    return { validatedAddons, addonTotal };
  }

  // ─── Inventory helpers ────────────────────────────────────────────────────

  private async reserveAddonInventory(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    addons: ValidatedAddon[], propertyId: string,
  ) {
    for (const addon of addons) {
      if (addon.product.category === 'COMMODITY') {
        await tx.inventory.updateMany({
          where: { product_id: addon.product.id, property_id: propertyId },
          data: {
            available_stock: { decrement: addon.quantity },
            reserved_stock: { increment: addon.quantity },
          },
        });
      }
    }
  }

  private async releaseAddonInventory(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    eri: string, propertyId: string,
  ) {
    const addonOrder = await tx.addon_orders.findFirst({
      where: { ezee_reservation_id: eri, status: 'PENDING' },
      include: { addon_order_items: { include: { product_catalog: true } } },
    });

    if (!addonOrder) return;

    for (const item of addonOrder.addon_order_items) {
      if (item.product_catalog.category === 'COMMODITY') {
        await tx.inventory.updateMany({
          where: { product_id: item.product_id, property_id: propertyId },
          data: {
            available_stock: { increment: item.quantity },
            reserved_stock: { decrement: item.quantity },
          },
        });
      }
    }

    await tx.addon_order_items.deleteMany({ where: { addon_order_id: addonOrder.id } });
    await tx.addon_orders.delete({ where: { id: addonOrder.id } });
  }

  private async finalizeAddonInventory(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    eri: string, propertyId: string,
  ) {
    const addonOrder = await tx.addon_orders.findFirst({
      where: { ezee_reservation_id: eri, status: 'PENDING' },
      include: { addon_order_items: { include: { product_catalog: true } } },
    });

    if (!addonOrder) return;

    for (const item of addonOrder.addon_order_items) {
      if (item.product_catalog.category === 'COMMODITY') {
        await tx.inventory.updateMany({
          where: { product_id: item.product_id, property_id: propertyId },
          data: {
            reserved_stock: { decrement: item.quantity },
            sold_count: { increment: item.quantity },
          },
        });
      }
    }

    await tx.addon_orders.update({
      where: { id: addonOrder.id },
      data: { status: 'PAID' },
    });
  }

  // ─── Formatters ───────────────────────────────────────────────────────────

  private formatBooking(booking: any) {
    return {
      ezee_reservation_id: booking.ezee_reservation_id,
      property_id: booking.property_id,
      room_type_name: booking.room_type_name,
      room_number: booking.room_number,
      checkin_date: booking.checkin_date,
      checkout_date: booking.checkout_date,
      no_of_guests: booking.no_of_guests,
      source: booking.source,
      status: booking.status,
    };
  }

  private formatSlot(slot: any) {
    return {
      slot_id: slot.id,
      slot_number: slot.slot_number,
      label: slot.label,
      guest_id: slot.guest_id,
      kyc_status: slot.kyc_status,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECK-IN STATUS (auth required — guest must be linked to the booking)
  // ═══════════════════════════════════════════════════════════════════════════

  async getCheckinStatus(guestId: string, bookingId: string) {
    const booking = await this.prisma.ezee_booking_cache.findFirst({
      where: { ezee_reservation_id: bookingId },
      include: { properties: { select: { name: true } } },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const access = await this.prisma.booking_guest_access.findFirst({
      where: { ezee_reservation_id: bookingId, guest_id: guestId, status: 'APPROVED' },
    });

    if (!access) {
      throw new ForbiddenException('You are not linked to this booking');
    }

    const lockAccess = await this.prisma.smart_lock_access.findFirst({
      where: { ezee_reservation_id: bookingId, pin_status: 'ACTIVE' },
      orderBy: { created_at: 'desc' },
    });

    return {
      booking_id: booking.ezee_reservation_id,
      status: booking.status,
      room_number: booking.room_number,
      property_name: booking.properties?.name ?? 'The Daily Social',
      checkin_date: booking.checkin_date,
      checkout_date: booking.checkout_date,
      lock_access: lockAccess
        ? {
            pin: lockAccess.mygate_pin,
            valid_from: lockAccess.valid_from,
            valid_until: lockAccess.valid_until,
            pin_status: lockAccess.pin_status,
          }
        : null,
    };
  }
}
