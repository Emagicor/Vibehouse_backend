import {
  BadRequestException,
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
import { LookupBookingDto } from './dto/lookup-booking.dto';
import { CreateBookingOrderDto } from './dto/create-booking-order.dto';
import { CurrentGuest } from '../../common/decorators/current-guest.decorator';
import type { GuestJwtPayload } from '../../common/guards/guest-jwt.strategy';

@Controller('guest/booking')
export class GuestBookingController {
  constructor(private readonly bookingService: GuestBookingService) {}

  // ─── PUBLIC (no auth) ──────────────────────────────────────────────────────

  /**
   * GET /guest/booking/rooms?property_id=...
   *
   * Room CATALOG — no dates required.
   * Returns all active room types with base prices, amenities, and physical
   * room counts. Uses eZee Vacation Rental get_rooms API so every configured
   * room type is always returned regardless of current availability.
   *
   * Frontend use: homepage / room listing page (before dates are selected).
   */
  @Get('rooms')
  async getRoomCatalog(
    @Query('property_id') propertyId: string,
  ) {
    return this.bookingService.getRoomCatalog(propertyId);
  }

  /**
   * GET /guest/booking/availability?property_id=...&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD
   *
   * Live AVAILABILITY — checkin and checkout are required.
   * Returns the same room types with live eZee rates and available bed counts
   * for the requested dates. Rooms with 0 availability appear with
   * inventory_state="sold_out" rather than disappearing from the response.
   *
   * Frontend use: after guest selects dates, before the create-order step.
   */
  @Get('availability')
  async getRoomAvailability(
    @Query('property_id') propertyId: string,
    @Query('checkin') checkin: string,
    @Query('checkout') checkout: string,
  ) {
    if (!checkin || !checkout) {
      throw new BadRequestException('checkin and checkout query params are required');
    }
    if (!propertyId) {
      throw new BadRequestException('property_id query param is required');
    }
    return this.bookingService.getRoomAvailability(propertyId, checkin, checkout);
  }

  /**
   * GET /guest/booking/lookup?booking_id=EZEE-KA-123456
   *
   * Public booking preview — no auth required.
   * Returns non-sensitive booking details (property, dates, room type, status).
   * Used by the "Find my booking" flow before the guest has created an account.
   * Booker email and phone are intentionally excluded.
   */
  @Get('lookup')
  async lookupBooking(@Query() dto: LookupBookingDto) {
    return this.bookingService.lookupBooking(dto.booking_id);
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

  /**
   * GET /guest/booking/checkin-status?booking_id=<ERI>
   * Returns current check-in status and smart lock PIN for the booking.
   * Guest must be linked (approved) to the booking.
   */
  @UseGuards(AuthGuard('guest-jwt'))
  @Get('checkin-status')
  async getCheckinStatus(
    @CurrentGuest() guest: GuestJwtPayload,
    @Query('booking_id') bookingId: string,
  ) {
    if (!bookingId) {
      throw new BadRequestException('booking_id query param is required');
    }
    return this.bookingService.getCheckinStatus(guest.guest_id, bookingId);
  }
}
