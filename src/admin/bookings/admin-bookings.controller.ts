import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '../../common/guards/admin-jwt.strategy';
import { PaymentService } from '../../payment/payment.service';
import { CreateManualBookingDto } from './dto/create-manual-booking.dto';

@Controller('admin/bookings')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminBookingsController {
  constructor(
    private readonly bookingsService: AdminBookingsService,
    private readonly paymentService: PaymentService,
  ) {}

  // ─── MANUAL BOOKING (walk-in) ───────────────────────────────────────────

  /**
   * POST /admin/bookings/create-order
   * Creates a pending booking on behalf of a walk-in guest.
   * Returns booking summary with grand_total for payment.
   */
  @Post('create-order')
  @RequirePermission('bookings.create')
  createManualBooking(
    @Body() dto: CreateManualBookingDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    return this.bookingsService.createManualBooking(dto, admin);
  }

  /**
   * POST /admin/bookings/:eri/pay
   * Creates a Razorpay order for a pending manual booking.
   * Admin opens Razorpay on dashboard, customer pays on-site.
   */
  @Post(':eri/pay')
  @RequirePermission('bookings.create')
  async createPaymentForBooking(
    @Param('eri') eri: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    // Find the pending booking
    const booking = await this.bookingsService.getBookingDetail(eri, admin);

    if (booking.status !== 'PENDING_PAYMENT') {
      return { message: `Booking is already ${booking.status}`, eri };
    }

    if (!booking.booker) {
      return { message: 'No guest linked to this booking', eri };
    }

    // Calculate grand total from latest payment or re-derive from booking
    // Find addon order if any
    const addonOrderId = booking.addon_orders?.[0]?.id ?? null;

    // Sum up payment amount — find the room total from the booking
    // For manual bookings, we need to re-fetch payments or use the existing pending amount
    const existingPayment = booking.payments.find((p) => p.status === 'CREATED');
    if (existingPayment) {
      return {
        message: 'Razorpay order already exists for this booking. Use it to complete payment.',
        razorpay_order_id: existingPayment.razorpay_order_id,
        amount: Number(existingPayment.amount),
        payment_id: existingPayment.id,
        eri,
      };
    }

    // Derive grand total: room total + addon total
    const addonTotal = booking.addon_orders.reduce(
      (sum, o) => sum + o.items.reduce((s, i) => s + i.total_price, 0),
      0,
    );

    // We need to re-calculate room total (not stored separately)
    // Re-fetch room types for price calculation
    const grandTotal = await this.calculateBookingTotal(eri, booking.property?.id ?? '', addonTotal);

    // Create Razorpay order using a guest-like payload
    const guestPayload = {
      guest_id: booking.booker.id,
      email: booking.booker.email ?? '',
    };

    return this.paymentService.createBookingPayment(
      guestPayload as any,
      eri,
      grandTotal,
      addonOrderId,
    );
  }

  // ─── BOOKING DASHBOARD ──────────────────────────────────────────────────

  /**
   * GET /admin/bookings
   * Lists all bookings with pagination and optional filters.
   * Scoped to admin's property (owners see all).
   */
  @Get()
  @RequirePermission('bookings.view')
  listBookings(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Query('status') status?: string,
    @Query('property_id') propertyId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.bookingsService.listBookings(admin, {
      status,
      property_id: propertyId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /**
   * GET /admin/bookings/search-guests?q=...
   * Searches guests by name, email, or phone for the manual booking form.
   */
  @Get('search-guests')
  @RequirePermission('bookings.create')
  searchGuests(@Query('q') query: string) {
    return this.bookingsService.searchGuests(query);
  }

  /**
   * GET /admin/bookings/:eri
   * Gets full booking detail with guests, slots, payments, and addon orders.
   */
  @Get(':eri')
  @RequirePermission('bookings.view')
  getBookingDetail(
    @Param('eri') eri: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    return this.bookingsService.getBookingDetail(eri, admin);
  }

  // ─── PRIVATE ─────────────────────────────────────────────────────────────

  private async calculateBookingTotal(
    eri: string,
    propertyId: string,
    addonTotal: number,
  ): Promise<number> {
    // Fetch booking to get room info
    const booking = await this.bookingsService['prisma'].ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: eri },
    });

    if (!booking || !booking.checkin_date || !booking.checkout_date) {
      throw new Error('Cannot calculate total: booking dates missing');
    }

    const noOfNights = Math.ceil(
      (booking.checkout_date.getTime() - booking.checkin_date.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Parse room_type_name: "Queen Size Room x2, 4 Bed Mixed Dormitory x3"
    const roomTypes = await this.bookingsService['prisma'].room_types.findMany({
      where: { property_id: propertyId, is_active: true },
    });

    let roomTotal = 0;
    const parts = (booking.room_type_name ?? '').split(', ');
    for (const part of parts) {
      const match = part.match(/^(.+)\s+x(\d+)$/);
      if (match) {
        const rtName = match[1];
        const qty = parseInt(match[2], 10);
        const rt = roomTypes.find((r) => r.name === rtName);
        if (rt) {
          roomTotal += Number(rt.base_price_per_night) * noOfNights * qty;
        }
      }
    }

    return roomTotal + addonTotal;
  }
}
