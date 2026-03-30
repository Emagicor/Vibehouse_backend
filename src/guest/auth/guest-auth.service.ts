import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { GuestSignupDto } from './dto/signup.dto';
import { GuestLoginDto } from './dto/login.dto';
import type { GuestJwtPayload } from '../../common/guards/guest-jwt.strategy';
import type { GoogleOAuthUser } from './google.strategy';

@Injectable()
export class GuestAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly emailService: EmailService,
  ) {}

  async signup(dto: GuestSignupDto) {
    const existing = await this.prisma.guests.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    if (dto.phone) {
      const phoneExists = await this.prisma.guests.findUnique({
        where: { phone: dto.phone },
      });
      if (phoneExists) {
        throw new ConflictException('Phone number already registered');
      }
    }

    const password_hash = await bcrypt.hash(dto.password, 12);
    const id = uuidv4();

    const guest = await this.prisma.guests.create({
      data: {
        id,
        name: dto.name,
        email: dto.email,
        phone: dto.phone ?? null,
        password_hash,
        email_verified: false,
        phone_verified: false,
      },
    });

    // Record the auth provider
    await this.prisma.auth_providers.create({
      data: {
        id: uuidv4(),
        guest_id: id,
        provider: 'email',
        provider_uid: dto.email,
      },
    });

    const token = this.issueToken(guest);

    return {
      access_token: token,
      guest: this.formatGuest(guest),
    };
  }

  async login(dto: GuestLoginDto) {
    const guest = await this.prisma.guests.findUnique({
      where: { email: dto.email },
    });

    if (!guest || !guest.password_hash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, guest.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.issueToken(guest);

    return {
      access_token: token,
      guest: this.formatGuest(guest),
    };
  }

  async getMe(guestId: string) {
    const guest = await this.prisma.guests.findUnique({
      where: { id: guestId },
    });

    if (!guest) {
      throw new UnauthorizedException('Guest not found');
    }

    // Fetch linked bookings summary
    const bookings = await this.prisma.booking_guest_access.findMany({
      where: { guest_id: guestId },
      include: { ezee_booking_cache: true },
      orderBy: { created_at: 'desc' },
    });

    return {
      ...this.formatGuest(guest),
      bookings: bookings.map((b) => ({
        ezee_reservation_id: b.ezee_reservation_id,
        role: b.role,
        status: b.status,
        checkin_date: b.ezee_booking_cache.checkin_date,
        checkout_date: b.ezee_booking_cache.checkout_date,
        room_type_name: b.ezee_booking_cache.room_type_name,
        property_id: b.ezee_booking_cache.property_id,
      })),
    };
  }

  // ─── EMAIL OTP ────────────────────────────────────────────────────────────

  async sendOtp(email: string) {
    // Look up the guest (must already have an account)
    const guest = await this.prisma.guests.findUnique({ where: { email } });
    if (!guest) {
      throw new NotFoundException('No account found with this email address');
    }
    if (guest.email_verified) {
      throw new BadRequestException('Email is already verified');
    }

    // Rate-limit: block re-send within 60 seconds
    const recentOtp = await this.prisma.otp_logs.findFirst({
      where: {
        guest_id: guest.id,
        channel: 'email',
        purpose: 'email_verification',
        used_at: null,
        created_at: { gte: new Date(Date.now() - 60_000) },
      },
      orderBy: { created_at: 'desc' },
    });
    if (recentOtp) {
      throw new BadRequestException(
        'Please wait 60 seconds before requesting another OTP',
      );
    }

    // Generate 6-digit OTP and hash it
    const otp = String(Math.floor(100_000 + Math.random() * 900_000));
    const otp_hash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000); // +10 minutes

    await this.prisma.otp_logs.create({
      data: {
        id: uuidv4(),
        guest_id: guest.id,
        recipient: email,
        channel: 'email',
        purpose: 'email_verification',
        otp_hash,
        expires_at: expiresAt,
      },
    });

    await this.emailService.sendOtpEmail({
      toEmail: email,
      toName: guest.name || 'Guest',
      otp,
      expiresAt,
    });

    return {
      message: 'OTP sent to your email address',
      expires_in_seconds: 600,
    };
  }

  async verifyOtp(email: string, otp: string) {
    const guest = await this.prisma.guests.findUnique({ where: { email } });
    if (!guest) {
      throw new NotFoundException('No account found with this email address');
    }

    // Find the most recent unused + non-expired OTP
    const log = await this.prisma.otp_logs.findFirst({
      where: {
        guest_id: guest.id,
        channel: 'email',
        purpose: 'email_verification',
        used_at: null,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!log) {
      throw new BadRequestException('OTP expired or not found. Please request a new one.');
    }

    const valid = await bcrypt.compare(otp, log.otp_hash);
    if (!valid) {
      throw new BadRequestException('Invalid OTP');
    }

    // Mark OTP as used + set email verified in a transaction
    const [updatedGuest] = await this.prisma.$transaction([
      this.prisma.guests.update({
        where: { id: guest.id },
        data: { email_verified: true },
      }),
      this.prisma.otp_logs.update({
        where: { id: log.id },
        data: { used_at: new Date() },
      }),
    ]);

    return {
      message: 'Email verified successfully',
      access_token: this.issueToken(updatedGuest),
      guest: this.formatGuest(updatedGuest),
    };
  }

  // ─── PASSWORD RESET ───────────────────────────────────────────────────────

  async forgotPassword(email: string) {
    const guest = await this.prisma.guests.findUnique({ where: { email } });
    if (!guest) {
      throw new NotFoundException('No account found with this email address');
    }

    // OAuth-only accounts have no password — can't reset what doesn't exist
    if (!guest.password_hash) {
      throw new BadRequestException(
        'This account uses Google login. Please sign in with Google instead.',
      );
    }

    // Rate-limit: block re-send within 60 seconds
    const recentOtp = await this.prisma.otp_logs.findFirst({
      where: {
        guest_id: guest.id,
        channel: 'email',
        purpose: 'password_reset',
        used_at: null,
        created_at: { gte: new Date(Date.now() - 60_000) },
      },
      orderBy: { created_at: 'desc' },
    });
    if (recentOtp) {
      throw new BadRequestException(
        'Please wait 60 seconds before requesting another OTP',
      );
    }

    const otp = String(Math.floor(100_000 + Math.random() * 900_000));
    const otp_hash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);

    await this.prisma.otp_logs.create({
      data: {
        id: uuidv4(),
        guest_id: guest.id,
        recipient: email,
        channel: 'email',
        purpose: 'password_reset',
        otp_hash,
        expires_at: expiresAt,
      },
    });

    await this.emailService.sendOtpEmail({
      toEmail: email,
      toName: guest.name || 'Guest',
      otp,
      expiresAt,
      purpose: 'password_reset',
    });

    return {
      message: 'Password reset OTP sent to your email',
      expires_in_seconds: 600,
    };
  }

  async resetPassword(email: string, otp: string, newPassword: string) {
    const guest = await this.prisma.guests.findUnique({ where: { email } });
    if (!guest) {
      throw new NotFoundException('No account found with this email address');
    }

    // Find the most recent unused + non-expired password_reset OTP
    const log = await this.prisma.otp_logs.findFirst({
      where: {
        guest_id: guest.id,
        channel: 'email',
        purpose: 'password_reset',
        used_at: null,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!log) {
      throw new BadRequestException('OTP expired or not found. Please request a new one.');
    }

    const valid = await bcrypt.compare(otp, log.otp_hash);
    if (!valid) {
      throw new BadRequestException('Invalid OTP');
    }

    const password_hash = await bcrypt.hash(newPassword, 10);

    const [updatedGuest] = await this.prisma.$transaction([
      this.prisma.guests.update({
        where: { id: guest.id },
        data: { password_hash },
      }),
      this.prisma.otp_logs.update({
        where: { id: log.id },
        data: { used_at: new Date() },
      }),
    ]);

    return {
      message: 'Password updated successfully',
      access_token: this.issueToken(updatedGuest),
      guest: this.formatGuest(updatedGuest),
    };
  }

  // ─── GOOGLE OAUTH ─────────────────────────────────────────────────────────

  async googleLogin(googleUser: GoogleOAuthUser) {
    // 1. Check if this Google ID is already linked
    const existingProvider = await this.prisma.auth_providers.findUnique({
      where: {
        provider_provider_uid: {
          provider: 'google',
          provider_uid: googleUser.google_id,
        },
      },
      include: { guests: true },
    });

    if (existingProvider) {
      // Returning Google user — just issue token
      const guest = existingProvider.guests;
      return {
        access_token: this.issueToken(guest),
        guest: this.formatGuest(guest),
      };
    }

    // 2. No Google provider found — check if email already exists (email/password account)
    let guest = googleUser.email
      ? await this.prisma.guests.findUnique({ where: { email: googleUser.email } })
      : null;

    if (guest) {
      // Existing email account — link Google as an additional provider
      await this.prisma.auth_providers.create({
        data: {
          id: uuidv4(),
          guest_id: guest.id,
          provider: 'google',
          provider_uid: googleUser.google_id,
        },
      });

      // Mark email as verified since Google has verified it
      if (!guest.email_verified) {
        guest = await this.prisma.guests.update({
          where: { id: guest.id },
          data: {
            email_verified: true,
            profile_photo_url: guest.profile_photo_url ?? googleUser.profile_photo_url,
          },
        });
      }

      return {
        access_token: this.issueToken(guest),
        guest: this.formatGuest(guest),
      };
    }

    // 3. Completely new user — create guest + provider in one go
    const newId = uuidv4();
    const newGuest = await this.prisma.guests.create({
      data: {
        id: newId,
        name: googleUser.name,
        email: googleUser.email || null,
        phone: null,
        password_hash: null,           // OAuth-only account — no password
        email_verified: true,          // Google already verified the email
        phone_verified: false,
        profile_photo_url: googleUser.profile_photo_url,
      },
    });

    await this.prisma.auth_providers.create({
      data: {
        id: uuidv4(),
        guest_id: newId,
        provider: 'google',
        provider_uid: googleUser.google_id,
      },
    });

    return {
      access_token: this.issueToken(newGuest),
      guest: this.formatGuest(newGuest),
    };
  }

  private issueToken(guest: {
    id: string;
    email: string | null;
    email_verified: boolean;
    phone_verified: boolean;
  }): string {
    const payload: GuestJwtPayload = {
      sub: guest.id,
      guest_id: guest.id,
      email: guest.email,
      email_verified: guest.email_verified,
      phone_verified: guest.phone_verified,
    };
    return this.jwt.sign(payload);
  }

  private formatGuest(guest: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    email_verified: boolean;
    phone_verified: boolean;
    profile_photo_url: string | null;
    created_at: Date;
  }) {
    return {
      id: guest.id,
      name: guest.name,
      email: guest.email,
      phone: guest.phone,
      email_verified: guest.email_verified,
      phone_verified: guest.phone_verified,
      profile_photo_url: guest.profile_photo_url,
      created_at: guest.created_at,
    };
  }
}
