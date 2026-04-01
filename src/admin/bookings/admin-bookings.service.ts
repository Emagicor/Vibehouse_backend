import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminJwtPayload } from '../../common/guards/admin-jwt.strategy';

@Injectable()
export class AdminBookingsService {
  private readonly logger = new Logger(AdminBookingsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    const where: any = {};

    if (actor.property_id) {
      where.property_id = actor.property_id;
    } else if (filters?.property_id) {
      where.property_id = filters.property_id;
    }

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
}
