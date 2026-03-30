import { Controller, Post, Get, Body, UseGuards, Req, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { GuestAuthService } from './guest-auth.service';
import { GuestSignupDto } from './dto/signup.dto';
import { GuestLoginDto } from './dto/login.dto';
import { GuestJwtGuard } from '../../common/guards/guest-jwt.guard';
import { CurrentGuest } from '../../common/decorators/current-guest.decorator';
import type { GuestJwtPayload } from '../../common/guards/guest-jwt.strategy';
import type { GoogleOAuthUser } from './google.strategy';

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

  // ─── GOOGLE OAUTH ──────────────────────────────────────────────────────────

  /**
   * Step 1: Redirect the browser to Google's consent screen.
   * Frontend calls: GET /guest/auth/google
   * (No body, no JWT — browser navigates directly to this URL)
   */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {
    // Passport handles the redirect — this handler body never executes
  }

  /**
   * Step 2: Google redirects back here after the user grants consent.
   * Passport verifies the code, populates req.user with GoogleOAuthUser.
   * We issue a JWT and redirect to the frontend with it in the query string.
   */
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const googleUser = req.user as GoogleOAuthUser;
    const result = await this.guestAuthService.googleLogin(googleUser);

    // Redirect to frontend with token in query string.
    // Frontend reads `?token=...`, stores it, and closes the popup / navigates home.
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const redirect = `${frontendUrl}/auth/google/success?token=${result.access_token}&name=${encodeURIComponent(result.guest.name)}`;
    return res.redirect(redirect);
  }
}

