import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';
import { v4 as uuidv4 } from 'uuid';
import type { AdminJwtPayload } from '../../common/guards/admin-jwt.strategy';
import type { CreateManualBookingDto } from './dto/create-manual-booking.dto';

// Roles that can NOT create manual bookings
const BLOCKED_ROLES = ['HOUSEKEEPING_LEAD', 'MAINTENANCE_LEAD'];

@Injectable()
export class AdminBookingsService {
  private readonly logger = new Logger(AdminBookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE MANUAL BOOKING ORDER (on-site walk-in)
  // ═══════════════════════════════════════════════════════════════════════════

  async createManualBooking(dto: CreateManualBookingDto, actor: AdminJwtPayload) {
    // Block housekeeping / maintenance
    if (BLOCKED_ROLES.includes(actor.role)) {
      throw new ForbiddenException('Your role cannot create bookings');
    }

    // Property scoping — non-owner can only book for their property
    if (actor.property_id && actor.property_id !== dto.property_id) {
      throw new ForbiddenException('You can only create bookings for your assigned property');
    }

    const property = await this.prisma.properties.findUnique({ where: { id: dto.property_id } });
    if (!property) throw new NotFoundException('Property not found');

    // Parse & validate dates
    const checkin = new Date(dto.checkin_date);
    const checkout = new Date(dto.checkout_date);
    if (checkout <= checkin) {
      throw new BadRequestException('Checkout must be after checkin');
    }
    const noOfNights = Math.ceil(
      (checkout.getTime() - checkin.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Find or create guest
    const guest = await this.findOrCreateGuest(dto.guest_name, dto.guest_email, dto.guest_phone);

    // Validate rooms
    const roomTypes = await this.prisma.room_types.findMany({
      where: { property_id: dto.property_id, is_active: true },
    });

    const bookedMap = await this.getBookedBedsMap(dto.property_id, checkin, checkout, roomTypes);

    let roomTotal = 0;
    let totalGuests = 0;
    const validatedRooms: { roomType: typeof roomTypes[0]; quantity: number; lineTotal: number }[] = [];

    for (const sel of dto.rooms) {
      const rt = roomTypes.find((r) => r.id === sel.room_type_id);
      if (!rt) throw new NotFoundException(`Room type "${sel.room_type_id}" not found`);

      const available = Math.max(0, rt.total_beds - (bookedMap.get(rt.id) ?? 0));
      if (sel.quantity > available) {
        throw new BadRequestException(
          `"${rt.name}" — requested ${sel.quantity} beds but only ${available} available`,
        );
      }

      const lineTotal = Number(rt.base_price_per_night) * noOfNights * sel.quantity;
      roomTotal += lineTotal;
      totalGuests += sel.quantity;
      validatedRooms.push({ roomType: rt, quantity: sel.quantity, lineTotal });
    }

    // Validate addons
    let addonTotal = 0;
    const validatedAddons: { product: any; quantity: number; lineTotal: number }[] = [];

    for (const addon of dto.addons ?? []) {
      const product = await this.prisma.product_catalog.findFirst({
        where: { id: addon.product_id, property_id: dto.property_id, is_active: true },
      });
      if (!product) throw new NotFoundException(`Product "${addon.product_id}" not found`);
      if (product.category === 'BORROWABLE') {
        throw new BadRequestException('Borrowable items cannot be added to booking cart');
      }

      if (product.category === 'COMMODITY') {
        const inv = await this.prisma.inventory.findFirst({
          where: { product_id: product.id, property_id: dto.property_id },
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

    const grandTotal = roomTotal + addonTotal;
    const eri = this.generateERI(dto.property_id);
    const roomTypeSummary = validatedRooms.map((r) => `${r.roomType.name} x${r.quantity}`).join(', ');

    // Persist in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Reserve addon inventory
      for (const addon of validatedAddons) {
        if (addon.product.category === 'COMMODITY') {
          await tx.inventory.updateMany({
            where: { product_id: addon.product.id, property_id: dto.property_id },
            data: {
              available_stock: { decrement: addon.quantity },
              reserved_stock: { increment: addon.quantity },
            },
          });
        }
      }

      // Create booking cache
      await tx.ezee_booking_cache.create({
        data: {
          ezee_reservation_id: eri,
          property_id: dto.property_id,
          guest_id: guest.id,
          booker_email: dto.guest_email ?? null,
          booker_phone: dto.guest_phone ?? null,
          room_type_name: roomTypeSummary,
          checkin_date: checkin,
          checkout_date: checkout,
          no_of_guests: totalGuests,
          source: 'WALK_IN',
          status: 'PENDING_PAYMENT',
          is_active: true,
          fetched_at: new Date(),
        },
      });

      // Create guest access
      await tx.booking_guest_access.create({
        data: {
          id: uuidv4(),
          ezee_reservation_id: eri,
          guest_id: guest.id,
          role: 'PRIMARY',
          status: 'APPROVED',
          approved_by_guest_id: guest.id,
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
            guest_id: guest.id,
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
      for (let i = 1; i <= totalGuests; i++) {
        await tx.booking_slots.create({
          data: {
            id: uuidv4(),
            ezee_reservation_id: eri,
            slot_number: i,
            guest_id: i === 1 ? guest.id : null,
            label: `Guest ${i}`,
            kyc_status: 'NOT_STARTED',
          },
        });
      }

      // Log activity
      await tx.admin_activity_log.create({
        data: {
          id: uuidv4(),
          actor_type: 'ADMIN',
          actor_id: actor.admin_id,
          action: 'MANUAL_BOOKING_CREATED',
          entity_type: 'booking',
          entity_id: eri,
          new_value: {
            guest_id: guest.id,
            guest_name: dto.guest_name,
            rooms: roomTypeSummary,
            grand_total: grandTotal,
            source: 'WALK_IN',
          },
        },
      });

      return { addonOrderId };
    });

    this.logger.log(`Manual booking created: ERI=${eri} by admin ${actor.admin_id}`);

    return {
      ezee_reservation_id: eri,
      guest_id: guest.id,
      guest_name: guest.name,
      property_id: dto.property_id,
      property_name: property.name,
      checkin_date: dto.checkin_date,
      checkout_date: dto.checkout_date,
      no_of_nights: noOfNights,
      total_guests: totalGuests,
      rooms: validatedRooms.map((r) => ({
        room_type_id: r.roomType.id,
        room_type_name: r.roomType.name,
        type: r.roomType.type,
        quantity: r.quantity,
        price_per_night: Number(r.roomType.base_price_per_night),
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
      source: 'WALK_IN',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST ALL BOOKINGS (dashboard)
  // ═══════════════════════════════════════════════════════════════════════════

  async listBookings(
    actor: AdminJwtPayload,
    filters?: { status?: string; property_id?: string; page?: number; limit?: number },
  ) {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 20;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};

    // Property scoping
    if (actor.property_id) {
      where.property_id = actor.property_id;
    } else if (filters?.property_id) {
      where.property_id = filters.property_id;
    }

    // Status filter
    if (filters?.status) {
      where.status = filters.status;
    }

    const [bookings, total] = await Promise.all([
      this.prisma.ezee_booking_cache.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: {
          guests: { select: { id: true, name: true, email: true, phone: true } },
          properties: { select: { id: true, name: true } },
          payments: {
            select: { id: true, amount: true, status: true, purpose: true, razorpay_order_id: true, created_at: true },
            orderBy: { created_at: 'desc' },
            take: 1,
          },
          booking_guest_access: {
            select: { guest_id: true, role: true, status: true },
          },
        },
      }),
      this.prisma.ezee_booking_cache.count({ where }),
    ]);

    return {
      bookings: bookings.map((b) => ({
        ezee_reservation_id: b.ezee_reservation_id,
        property: b.properties ? { id: b.properties.id, name: b.properties.name } : null,
        guest: b.guests ? { id: b.guests.id, name: b.guests.name, email: b.guests.email, phone: b.guests.phone } : null,
        room_type_name: b.room_type_name,
        room_number: b.room_number,
        checkin_date: b.checkin_date,
        checkout_date: b.checkout_date,
        no_of_guests: b.no_of_guests,
        source: b.source,
        status: b.status,
        is_active: b.is_active,
        created_at: b.created_at,
        latest_payment: b.payments[0] ?? null,
        guest_count: b.booking_guest_access.length,
      })),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOKING DETAIL (with addons)
  // ═══════════════════════════════════════════════════════════════════════════

  async getBookingDetail(eri: string, actor: AdminJwtPayload) {
    const booking = await this.prisma.ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: eri },
      include: {
        guests: { select: { id: true, name: true, email: true, phone: true } },
        properties: { select: { id: true, name: true, city: true } },
        booking_guest_access: {
          include: {
            guests_booking_guest_access_guest_idToguests: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        },
        booking_slots: {
          orderBy: { slot_number: 'asc' },
          include: {
            guests: { select: { id: true, name: true } },
          },
        },
        payments: {
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            amount: true,
            currency: true,
            purpose: true,
            status: true,
            razorpay_order_id: true,
            razorpay_payment_id: true,
            created_at: true,
            updated_at: true,
          },
        },
        addon_orders: {
          include: {
            addon_order_items: {
              include: {
                product_catalog: { select: { id: true, name: true, category: true } },
              },
            },
          },
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!booking) throw new NotFoundException(`Booking "${eri}" not found`);

    // Property scoping
    if (actor.property_id && booking.property_id !== actor.property_id) {
      throw new ForbiddenException('You do not have access to this booking');
    }

    return {
      ezee_reservation_id: booking.ezee_reservation_id,
      property: booking.properties,
      booker: booking.guests,
      booker_email: booking.booker_email,
      booker_phone: booking.booker_phone,
      room_type_name: booking.room_type_name,
      room_number: booking.room_number,
      checkin_date: booking.checkin_date,
      checkout_date: booking.checkout_date,
      no_of_guests: booking.no_of_guests,
      source: booking.source,
      status: booking.status,
      is_active: booking.is_active,
      created_at: booking.created_at,
      guests: booking.booking_guest_access.map((a) => ({
        guest: a.guests_booking_guest_access_guest_idToguests,
        role: a.role,
        status: a.status,
      })),
      slots: booking.booking_slots.map((s) => ({
        slot_number: s.slot_number,
        label: s.label,
        guest: s.guests ? { id: s.guests.id, name: s.guests.name } : null,
        kyc_status: s.kyc_status,
      })),
      payments: booking.payments,
      addon_orders: booking.addon_orders.map((o) => ({
        id: o.id,
        phase: o.phase,
        status: o.status,
        created_at: o.created_at,
        items: o.addon_order_items.map((i) => ({
          product: i.product_catalog,
          quantity: i.quantity,
          unit_price: Number(i.unit_price),
          total_price: Number(i.total_price),
          unit_code: i.unit_code,
        })),
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEARCH GUESTS (for manual booking form)
  // ═══════════════════════════════════════════════════════════════════════════

  async searchGuests(query: string) {
    if (!query || query.length < 2) {
      throw new BadRequestException('Search query must be at least 2 characters');
    }

    const guests = await this.prisma.guests.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
        ],
      },
      select: { id: true, name: true, email: true, phone: true },
      take: 10,
    });

    return guests;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async findOrCreateGuest(name: string, email?: string, phone?: string) {
    if (!email && !phone) {
      throw new BadRequestException('Guest email or phone is required');
    }

    // Try to find by email or phone
    if (email) {
      const found = await this.prisma.guests.findUnique({ where: { email } });
      if (found) return found;
    }
    if (phone) {
      const found = await this.prisma.guests.findUnique({ where: { phone } });
      if (found) return found;
    }

    // Create new guest
    const guest = await this.prisma.guests.create({
      data: {
        id: uuidv4(),
        name,
        email: email ?? null,
        phone: phone ?? null,
        email_verified: false,
        phone_verified: false,
      },
    });

    this.logger.log(`Created walk-in guest: ${guest.id} (${name})`);
    return guest;
  }

  private generateERI(propertyId: string): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = uuidv4().slice(0, 4).toUpperCase();
    const code = propertyId.split('-')[1]?.toUpperCase() ?? 'VH';
    return `VH-${code}-${timestamp}-${random}`;
  }

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
}
