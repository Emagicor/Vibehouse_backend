import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
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
  // ROOM AVAILABILITY
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

    // eZee is the single source of truth — room types, availability, and pricing
    // all come from eZee. Local DB is only a last-resort fallback if eZee is down.

    let resultRoomTypes: any[];

    try {
      const inventory = await this.ezee.getRoomInventory(propertyId, checkinDate, checkoutDate);

      resultRoomTypes = inventory.rooms.map((room) => ({
        id: room.roomTypeId,
        name: room.roomTypeName,
        available_beds: room.availability,
        base_price_per_night: room.ratePerNight,
        total_price: room.ratePerNight * noOfNights,
        ezee_room_type_id: room.roomTypeId,
        ezee_rate_plan_id: room.ratePlanId,
        ezee_rate_type_id: room.rateTypeId,
      }));

      this.logger.debug(`Room availability from eZee: ${resultRoomTypes.map(r => `${r.name}=${r.available_beds}@₹${r.base_price_per_night}`).join(', ')}`);
    } catch (err) {
      // eZee unreachable — fall back to local DB so the app doesn't break
      this.logger.warn(`eZee unavailable, falling back to local DB: ${(err as Error).message}`);

      const roomTypes = await this.prisma.room_types.findMany({
        where: { property_id: propertyId, is_active: true },
        orderBy: { base_price_per_night: 'asc' },
      });

      if (roomTypes.length === 0) {
        throw new NotFoundException('No room types found for this property');
      }

      const { checkin, checkout } = this.parseDateRange(checkinDate, checkoutDate);
      const bookedMap = await this.getBookedBedsMap(propertyId, checkin, checkout, roomTypes);

      resultRoomTypes = roomTypes.map((rt) => ({
        id: rt.id,
        name: rt.name,
        available_beds: Math.max(0, rt.total_beds - (bookedMap.get(rt.id) ?? 0)),
        base_price_per_night: Number(rt.base_price_per_night),
        total_price: Number(rt.base_price_per_night) * noOfNights,
        ezee_room_type_id: rt.ezee_room_type_id,
        ezee_rate_plan_id: rt.ezee_rate_plan_id,
        ezee_rate_type_id: rt.ezee_rate_type_id,
      }));
    }

    const result = {
      property_id: propertyId,
      checkin_date: checkinDate,
      checkout_date: checkoutDate,
      no_of_nights: noOfNights,
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
    const eri = this.generateERI(dto.property_id);
    const roomTypeSummary = validatedRooms.map((r) => `${r.roomType.name} x${r.quantity}`).join(', ');

    // Persist everything in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
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
          source: 'VibeHouse',
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
    const checkin = new Date(checkinDate);
    const checkout = new Date(checkoutDate);

    if (checkout <= checkin) {
      throw new BadRequestException('Checkout must be after checkin');
    }

    const noOfNights = Math.ceil(
      (checkout.getTime() - checkin.getTime()) / (1000 * 60 * 60 * 24),
    );

    return { checkin, checkout, noOfNights };
  }

  // ─── ERI generation ───────────────────────────────────────────────────────

  private generateERI(propertyId: string): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = uuidv4().slice(0, 4).toUpperCase();
    const code = propertyId.split('-')[1]?.toUpperCase() ?? 'VH';
    return `VH-${code}-${timestamp}-${random}`;
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
}
