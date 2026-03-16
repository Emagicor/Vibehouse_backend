import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminLoginDto } from './dto/login.dto';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: AdminLoginDto, ipAddress?: string) {
    // Step 1: Fetch user with their role
    const admin = await this.prisma.admin_users.findFirst({
      where: {
        email: dto.email,
        is_active: true,
      },
      include: {
        admin_roles: true,
      },
    });

    if (!admin || !admin.admin_roles.is_active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Step 2: Validate role matches BEFORE checking password (per workflow 14)
    if (admin.admin_roles.name !== dto.role) {
      throw new ForbiddenException('You are not authorised for this role');
    }

    // Step 3: Verify password
    const passwordValid = await bcrypt.compare(dto.password, admin.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Step 4: Issue JWT
    const permissions = admin.admin_roles.permissions as string[];
    const payload = {
      sub: admin.id,
      admin_id: admin.id,
      role: admin.admin_roles.name,
      role_id: admin.role_id,
      property_id: admin.property_id ?? null,
      permissions,
    };

    const access_token = this.jwtService.sign(payload);

    // Step 5: Update last_login_at and write audit log
    await this.prisma.admin_users.update({
      where: { id: admin.id },
      data: { last_login_at: new Date() },
    });

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: admin.id,
        action: 'LOGIN',
        entity_type: 'SESSION',
        entity_id: uuidv4(),
        ip_address: ipAddress ?? null,
      },
    });

    return {
      access_token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.admin_roles.name,
        display_name: admin.admin_roles.display_name,
        property_id: admin.property_id,
        permissions,
      },
    };
  }

  async getProfile(adminId: string) {
    const admin = await this.prisma.admin_users.findUnique({
      where: { id: adminId },
      include: { admin_roles: true },
    });

    if (!admin || !admin.is_active) {
      throw new UnauthorizedException('Account not found or deactivated');
    }

    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      phone: admin.phone,
      role: admin.admin_roles.name,
      display_name: admin.admin_roles.display_name,
      property_id: admin.property_id,
      permissions: admin.admin_roles.permissions,
      two_fa_enabled: admin.two_fa_enabled,
      last_login_at: admin.last_login_at,
      created_at: admin.created_at,
    };
  }
}
