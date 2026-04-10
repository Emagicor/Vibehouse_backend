import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Optional,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ColiveService } from './colive.service';
import { SearchColiveDto } from './dto/search-colive.dto';
import { CreateColiveQuoteDto } from './dto/create-quote.dto';
import { CreateCOliveDraftBookingDto } from './dto/create-draft-booking.dto';
import { CurrentGuest } from '../../common/decorators/current-guest.decorator';
import type { GuestJwtPayload } from '../../common/guards/guest-jwt.strategy';

@Controller('guest/colive')
export class ColiveController {
  constructor(private readonly coliveService: ColiveService) {}

  // ── PUBLIC ENDPOINTS (no auth required) ───────────────────────────────────

  /**
   * POST /guest/colive/search
   * Search colive properties by city, move-in date, duration, and lifestyle.
   * Fetches live pricing from eZee. Persists search session for analytics.
   */
  @Post('search')
  searchInventory(@Body() dto: SearchColiveDto) {
    return this.coliveService.searchInventory(dto);
  }

  /**
   * GET /guest/colive/properties/:property_id
   * Full property detail with room options, pricing, gallery, benefits, and stories.
   * Fetches live availability + rates from eZee.
   */
  @Get('properties/:property_id')
  getPropertyDetail(
    @Param('property_id') propertyId: string,
    @Query('move_in_date') moveInDate: string,
    @Query('duration_months', new DefaultValuePipe(1), ParseIntPipe) durationMonths: number,
    @Query('stay_type', new DefaultValuePipe('solo')) stayType: string,
  ) {
    return this.coliveService.getPropertyDetail(propertyId, moveInDate, durationMonths, stayType);
  }

  /**
   * GET /guest/colive/properties/:property_id/addons
   * Monthly add-on catalog for checkout step 2.
   */
  @Get('properties/:property_id/addons')
  getAddons(
    @Param('property_id') propertyId: string,
    @Query('duration_months', new DefaultValuePipe(1), ParseIntPipe) durationMonths: number,
  ) {
    return this.coliveService.getAddons(propertyId, durationMonths);
  }

  // ── AUTH REQUIRED ─────────────────────────────────────────────────────────

  /**
   * POST /guest/colive/quote
   * Compute exact pricing breakdown from eZee live rates + selected addons.
   * Quote is persisted for 30 minutes and referenced during draft booking.
   */
  @UseGuards(AuthGuard('guest-jwt'))
  @Post('quote')
  createQuote(
    @Body() dto: CreateColiveQuoteDto,
    @CurrentGuest() guest: GuestJwtPayload,
  ) {
    return this.coliveService.createQuote(dto, guest.guest_id);
  }

  /**
   * POST /guest/colive/draft-booking
   * Create a draft booking before payment.
   * Validates quote freshness, room availability, and addon availability.
   */
  @UseGuards(AuthGuard('guest-jwt'))
  @Post('draft-booking')
  createDraftBooking(
    @Body() dto: CreateCOliveDraftBookingDto,
    @CurrentGuest() guest: GuestJwtPayload,
  ) {
    return this.coliveService.createDraftBooking(dto, guest.guest_id);
  }

  /**
   * GET /guest/colive/bookings/:booking_id
   * Post-payment confirmation detail screen.
   * Returns onboarding links and next steps.
   */
  @UseGuards(AuthGuard('guest-jwt'))
  @Get('bookings/:booking_id')
  getBookingDetail(
    @Param('booking_id') bookingId: string,
    @CurrentGuest() guest: GuestJwtPayload,
  ) {
    return this.coliveService.getBookingDetail(bookingId, guest.guest_id);
  }
}
