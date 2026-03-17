import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';

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

  async validate(payload: AdminJwtPayload) {
    const cacheKey = CacheService.adminJwtKey(payload.admin_id);

    // Check cache first (returns true/false for is_active, or undefined for miss)
    const cached = await this.cacheService.get<boolean>(cacheKey);
    if (cached !== undefined) {
      if (!cached) throw new UnauthorizedException('Account deactivated');
      return payload;
    }

    // Cache miss — query DB
    const admin = await this.prisma.admin_users.findUnique({
      where: { id: payload.admin_id },
      select: { id: true, is_active: true },
    });

    const isActive = admin?.is_active ?? false;
    await this.cacheService.set(cacheKey, isActive, CacheService.TTL_JWT);

    if (!admin || !isActive) {
      throw new UnauthorizedException('Account deactivated');
    }

    return payload; // attached as req.user
  }
}

