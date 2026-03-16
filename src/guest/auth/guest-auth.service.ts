import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { GuestSignupDto } from './dto/signup.dto';
import { GuestLoginDto } from './dto/login.dto';
import type { GuestJwtPayload } from '../../common/guards/guest-jwt.strategy';

@Injectable()
export class GuestAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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
