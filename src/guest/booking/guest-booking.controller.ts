import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GuestBookingService } from './guest-booking.service';
import { LinkBookingDto } from './dto/link-booking.dto';
import { CurrentGuest } from '../../common/decorators/current-guest.decorator';
import type { GuestJwtPayload } from '../../common/guards/guest-jwt.strategy';

@Controller('guest/booking')
@UseGuards(AuthGuard('guest-jwt'))
export class GuestBookingController {
  constructor(private readonly bookingService: GuestBookingService) {}

  /**
   * POST /guest/booking/link
   * Link the authenticated guest to a booking (ERI).
   */
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
  @Get('mine')
  async getMyBookings(@CurrentGuest() guest: GuestJwtPayload) {
    return this.bookingService.getMyBookings(guest.guest_id);
  }
}
