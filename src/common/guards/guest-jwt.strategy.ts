import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';

export interface GuestJwtPayload {
  sub: string;
  guest_id: string;
  email: string | null;
  email_verified: boolean;
  phone_verified: boolean;
}

@Injectable()
export class GuestJwtStrategy extends PassportStrategy(Strategy, 'guest-jwt') {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'fallback-secret',
    });
  }

  async validate(payload: GuestJwtPayload) {
    const cacheKey = CacheService.guestJwtKey(payload.guest_id);

    // Check cache first (returns true if exists, or undefined for miss)
    const cached = await this.cacheService.get<boolean>(cacheKey);
    if (cached !== undefined) {
      if (!cached) throw new UnauthorizedException('Guest account not found');
      return payload;
    }

    // Cache miss — query DB
    const guest = await this.prisma.guests.findUnique({
      where: { id: payload.guest_id },
      select: { id: true },
    });

    const exists = !!guest;
    await this.cacheService.set(cacheKey, exists, CacheService.TTL_JWT);

    if (!guest) {
      throw new UnauthorizedException('Guest account not found');
    }

    return payload; // attached as req.user
  }
}

