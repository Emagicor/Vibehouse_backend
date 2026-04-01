import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '../../common/guards/admin-jwt.strategy';

@Controller('admin/bookings')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminBookingsController {
  constructor(private readonly bookingsService: AdminBookingsService) {}

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
}
