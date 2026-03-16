import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface AdminJwtPayload {
  sub: string;
  admin_id: string;
  role: string;
  role_id: string;
  property_id: string | null;
  permissions: string[];
}

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'fallback-secret',
    });
  }

  async validate(payload: AdminJwtPayload) {
    const admin = await this.prisma.admin_users.findUnique({
      where: { id: payload.admin_id },
      select: { id: true, is_active: true },
    });

    if (!admin || !admin.is_active) {
      throw new UnauthorizedException('Account deactivated');
    }

    return payload; // attached as req.user
  }
}
