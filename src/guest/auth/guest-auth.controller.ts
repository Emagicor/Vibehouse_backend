import { Controller, Post, Get, Body, UseGuards, Req, Res, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { GuestAuthService } from './guest-auth.service';
import { GuestSignupDto } from './dto/signup.dto';
import { GuestLoginDto } from './dto/login.dto';
import { SendOtpDto, VerifyOtpDto, ForgotPasswordDto, ResetPasswordDto } from './dto/otp.dto';
import { GuestJwtGuard } from '../../common/guards/guest-jwt.guard';
import { CurrentGuest } from '../../common/decorators/current-guest.decorator';
import type { GuestJwtPayload } from '../../common/guards/guest-jwt.strategy';
import type { GoogleOAuthUser } from './google.strategy';

/**
 * Custom guard that catches ALL passport-level errors and returns null
 * instead of throwing. This lets the controller handle the error
 * by redirecting to the frontend error page.
 */
class GoogleOAuthGuard extends AuthGuard('google') {
  handleRequest(err: any, user: any) {
    if (err || !user) {
      return null; // Don't throw — let the controller handle it
    }
    return user;
  }
}

@Controller('guest/auth')
export class GuestAuthController {
  private readonly logger = new Logger(GuestAuthController.name);

  constructor(private readonly guestAuthService: GuestAuthService) {}

  // ─── EMAIL / PASSWORD ──────────────────────────────────────────────────────

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

  // ─── EMAIL OTP ─────────────────────────────────────────────────────────────

  @Post('send-otp')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.guestAuthService.sendOtp(dto.email);
  }

  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.guestAuthService.verifyOtp(dto.email, dto.otp);
  }

  // ─── PASSWORD RESET ────────────────────────────────────────────────────────

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.guestAuthService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.guestAuthService.resetPassword(dto.email, dto.otp, dto.newPassword);
  }

  // ─── GOOGLE OAUTH ──────────────────────────────────────────────────────────

  /**
   * Step 1: Redirect browser to Google consent screen.
   */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {
    // Passport handles the redirect — this handler never executes
  }

  /**
   * Step 2: Google redirects back here after consent.
   *
   * Uses GoogleOAuthGuard (extends AuthGuard) which overrides handleRequest
   * to return null on failure instead of throwing. This way:
   * - Passport errors (code exchange, token exchange) → req.user is null → redirect to error page
   * - Service errors (DB, JWT) → caught by try/catch → redirect to error page
   * - Success → redirect to frontend with token
   */
  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    const googleUser = req.user as GoogleOAuthUser | null;

    if (!googleUser) {
      this.logger.error('Google OAuth callback: passport returned no user');
      return res.redirect(`${frontendUrl}/auth/google/error?reason=auth_failed`);
    }

    try {
      const result = await this.guestAuthService.googleLogin(googleUser);

      const redirect =
        `${frontendUrl}/auth/google/success` +
        `?token=${result.access_token}` +
        `&name=${encodeURIComponent(result.guest.name)}`;

      return res.redirect(redirect);
    } catch (err) {
      this.logger.error(
        'Google OAuth login processing failed:',
        err instanceof Error ? err.stack : err,
      );
      return res.redirect(`${frontendUrl}/auth/google/error?reason=login_failed`);
    }
  }
}
