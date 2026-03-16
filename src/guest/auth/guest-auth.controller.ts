import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { GuestAuthService } from './guest-auth.service';
import { GuestSignupDto } from './dto/signup.dto';
import { GuestLoginDto } from './dto/login.dto';
import { GuestJwtGuard } from '../../common/guards/guest-jwt.guard';
import { CurrentGuest } from '../../common/decorators/current-guest.decorator';
import type { GuestJwtPayload } from '../../common/guards/guest-jwt.strategy';

@Controller('guest/auth')
export class GuestAuthController {
  constructor(private readonly guestAuthService: GuestAuthService) {}

  @Post('signup')
  signup(@Body() dto: GuestSignupDto) {
    return this.guestAuthService.signup(dto);
  }

  @Post('login')
  login(@Body() dto: GuestLoginDto) {
    return this.guestAuthService.login(dto);
  }

  @Get('me')
  @UseGuards(GuestJwtGuard)
  getMe(@CurrentGuest() guest: GuestJwtPayload) {
    return this.guestAuthService.getMe(guest.guest_id);
  }
}
