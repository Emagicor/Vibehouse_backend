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
 * Custom guard for Google OAuth callback.
 *
 * NestJS's default AuthGuard throws UnauthorizedException when passport
 * fails (canActivate returns false if handleRequest returns falsy).
 * We override handleRequest to return a sentinel { failed: true } object
 * on error, so canActivate returns true and the handler gets a chance
 * to redirect the user to the frontend error page instead of 403/500.
 */
class GoogleOAuthGuard extends AuthGuard('google') {
  handleRequest(err: any, user: any, _info: any) {
    if (err || !user) {
      // Return a truthy sentinel so canActivate doesn't throw 403.
      // The handler checks for .failed to redirect to error page.
      return { failed: true, error: err?.message || 'No user returned' };
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
   * GoogleOAuthGuard ensures passport errors set req.user to a sentinel
   * { failed: true } instead of throwing. The handler checks this and
   * redirects to the error page. On success, it processes the login
   * and redirects to the success page with the JWT.
   */
  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    this.logger.log(`[GoogleOAuth] Callback hit. FRONTEND_URL=${frontendUrl}`);
    this.logger.log(`[GoogleOAuth] req.user = ${JSON.stringify(req.user)}`);

    const user = req.user as any;

    // Check if the guard returned our failure sentinel
    if (!user || user.failed) {
      this.logger.error(`[GoogleOAuth] Passport auth failed: ${user?.error || 'unknown'}`);
      return res.redirect(`${frontendUrl}/auth/google/error?reason=auth_failed`);
    }

    const googleUser = user as GoogleOAuthUser;

    try {
      this.logger.log(`[GoogleOAuth] Processing login for: ${googleUser.email}`);
      const result = await this.guestAuthService.googleLogin(googleUser);

      const redirect =
        `${frontendUrl}/auth/google/success` +
        `?token=${result.access_token}` +
        `&name=${encodeURIComponent(result.guest.name)}`;

      this.logger.log(`[GoogleOAuth] Success — redirecting to frontend`);
      return res.redirect(redirect);
    } catch (err) {
      this.logger.error(
        '[GoogleOAuth] Login processing failed:',
        err instanceof Error ? err.stack : err,
      );
      return res.redirect(`${frontendUrl}/auth/google/error?reason=login_failed`);
    }
  }
}
