import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface GuestJwtPayload {
  sub: string;
  guest_id: string;
  email: string | null;
  email_verified: boolean;
  phone_verified: boolean;
}

@Injectable()
export class GuestJwtStrategy extends PassportStrategy(Strategy, 'guest-jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'fallback-secret',
    });
  }

  async validate(payload: GuestJwtPayload) {
    const guest = await this.prisma.guests.findUnique({
      where: { id: payload.guest_id },
      select: { id: true },
    });

    if (!guest) {
      throw new UnauthorizedException('Guest account not found');
    }

    return payload; // attached as req.user
  }
}
