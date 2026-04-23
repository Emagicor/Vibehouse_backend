import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminRoomTypesService } from './admin-room-types.service';
import { UpdateColivePriceDto } from './dto/update-colive-price.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

@Controller('admin/room-types')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminRoomTypesController {
  constructor(private readonly roomTypesService: AdminRoomTypesService) {}

  /**
   * GET /admin/room-types?property_id=...
   * Lists all active room types with their colive monthly prices.
   * Used by the admin panel to display and edit colive pricing.
   */
  @Get()
  @RequirePermission('colive.price_manage')
  listRoomTypes(@Query('property_id') propertyId?: string) {
    return this.roomTypesService.listRoomTypes(propertyId);
  }

  /**
   * PATCH /admin/room-types/:id/colive-price
   * Set the monthly colive price for a room type.
   * Restricted to owner and manager roles.
   */
  @Patch(':id/colive-price')
  @RequirePermission('colive.price_manage')
  updateColivePrice(
    @Param('id') id: string,
    @Body() dto: UpdateColivePriceDto,
  ) {
    return this.roomTypesService.updateColivePrice(id, dto);
  }
}
