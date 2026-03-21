import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GuestBookingService } from './guest-booking.service';
import { LinkBookingDto } from './dto/link-booking.dto';
import { CreateBookingOrderDto } from './dto/create-booking-order.dto';
import { CurrentGuest } from '../../common/decorators/current-guest.decorator';
import type { GuestJwtPayload } from '../../common/guards/guest-jwt.strategy';

@Controller('guest/booking')
export class GuestBookingController {
  constructor(private readonly bookingService: GuestBookingService) {}

  // ─── PUBLIC (no auth) ──────────────────────────────────────────────────────

  /**
   * GET /guest/booking/rooms?property_id=...&checkin=...&checkout=...
   * Returns available room types with pricing and bed availability.
   * No auth required — visitors can browse.
   */
  @Get('rooms')
  async getRoomAvailability(
    @Query('property_id') propertyId: string,
    @Query('checkin') checkin: string,
    @Query('checkout') checkout: string,
  ) {
    return this.bookingService.getRoomAvailability(propertyId, checkin, checkout);
  }

  // ─── AUTH REQUIRED ─────────────────────────────────────────────────────────

  /**
   * POST /guest/booking/link
   * Link the authenticated guest to a booking (ERI).
   */
  @UseGuards(AuthGuard('guest-jwt'))
  @Post('link')
  async linkBooking(
    @CurrentGuest() guest: GuestJwtPayload,
    @Body() dto: LinkBookingDto,
  ) {
    return this.bookingService.linkBooking(
      guest.guest_id,
      dto.ezee_reservation_id,
    );
  }

  /**
   * GET /guest/booking/mine
   * List all bookings linked to the authenticated guest.
   */
  @UseGuards(AuthGuard('guest-jwt'))
  @Get('mine')
  async getMyBookings(@CurrentGuest() guest: GuestJwtPayload) {
    return this.bookingService.getMyBookings(guest.guest_id);
  }

  /**
   * POST /guest/booking/create-order
   * Validates room + addon selections, reserves inventory,
   * creates pending booking records. Returns summary for payment.
   */
  @UseGuards(AuthGuard('guest-jwt'))
  @Post('create-order')
  async createBookingOrder(
    @CurrentGuest() guest: GuestJwtPayload,
    @Body() dto: CreateBookingOrderDto,
  ) {
    return this.bookingService.createBookingOrder(guest.guest_id, dto);
  }
}
