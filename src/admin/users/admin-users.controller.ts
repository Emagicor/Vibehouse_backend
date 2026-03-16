import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminProfileDto } from './dto/update-admin-profile.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '../../common/guards/admin-jwt.strategy';

@Controller('admin/users')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Post()
  @RequirePermission('admin.create')
  create(
    @Body() dto: CreateAdminUserDto,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.adminUsersService.create(dto, actor);
  }

  @Get()
  @RequirePermission('admin.manage')
  findAll(@CurrentAdmin() actor: AdminJwtPayload) {
    return this.adminUsersService.findAll(actor.property_id);
  }

  @Get('roles')
  @RequirePermission('admin.manage')
  listRoles() {
    return this.adminUsersService.listRoles();
  }

  @Get(':id')
  @RequirePermission('admin.manage')
  findOne(@Param('id') id: string) {
    return this.adminUsersService.findOne(id);
  }

  // No @RequirePermission — any authenticated admin can edit their own profile.
  // Editing someone else requires hierarchy check enforced inside the service.
  @Patch(':id/profile')
  updateProfile(
    @Param('id') id: string,
    @Body() dto: UpdateAdminProfileDto,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.adminUsersService.updateProfile(id, dto, actor);
  }

  @Patch(':id/deactivate')
  @RequirePermission('admin.manage')
  deactivate(
    @Param('id') id: string,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.adminUsersService.deactivate(id, actor);
  }

  @Delete(':id')
  @RequirePermission('admin.manage')
  remove(
    @Param('id') id: string,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.adminUsersService.remove(id, actor);
  }
}
