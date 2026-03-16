import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/login.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '../../common/guards/admin-jwt.strategy';
import type { Request } from 'express';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    const ip = req.ip ?? (req.socket as any)?.remoteAddress;
    return this.adminAuthService.login(dto, ip);
  }

  @Get('me')
  @UseGuards(AdminJwtGuard)
  getProfile(@CurrentAdmin() admin: AdminJwtPayload) {
    return this.adminAuthService.getProfile(admin.admin_id);
  }
}
