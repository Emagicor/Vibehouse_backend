import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminProfileDto } from './dto/update-admin-profile.dto';
import { AdminJwtPayload } from '../../common/guards/admin-jwt.strategy';
import { ROLE_HIERARCHY } from '../../common/constants/role-hierarchy';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async create(dto: CreateAdminUserDto, actor: AdminJwtPayload) {
    const existing = await this.prisma.admin_users.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const role = await this.prisma.admin_roles.findUnique({
      where: { id: dto.role_id },
    });
    if (!role || !role.is_active) {
      throw new NotFoundException('Role not found or inactive');
    }

    const allowedTargets = ROLE_HIERARCHY[actor.role] ?? [];
    if (!allowedTargets.includes(role.name)) {
      throw new ForbiddenException(
        `A ${actor.role} cannot create a ${role.name} account`,
      );
    }

    const password_hash = await bcrypt.hash(dto.password, 12);
    const id = uuidv4();

    const admin = await this.prisma.admin_users.create({
      data: {
        id,
        name: dto.name,
        email: dto.email,
        phone: dto.phone ?? null,
        password_hash,
        role_id: dto.role_id,
        property_id: dto.property_id ?? null,
      },
      include: { admin_roles: true },
    });

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: actor.admin_id,
        action: 'ADMIN_CREATE',
        entity_type: 'admin_users',
        entity_id: id,
        new_value: { email: dto.email, role: role.name },
      },
    });

    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      phone: admin.phone,
      role: admin.admin_roles.name,
      display_name: admin.admin_roles.display_name,
      property_id: admin.property_id,
      is_active: admin.is_active,
      created_at: admin.created_at,
    };
  }

  async findAll(actorPropertyId: string | null) {
    const where = actorPropertyId
      ? { property_id: actorPropertyId }
      : {};

    const admins = await this.prisma.admin_users.findMany({
      where,
      include: { admin_roles: true },
      orderBy: { created_at: 'desc' },
    });

    return admins.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      phone: a.phone,
      role: a.admin_roles.name,
      display_name: a.admin_roles.display_name,
      property_id: a.property_id,
      is_active: a.is_active,
      last_login_at: a.last_login_at,
      created_at: a.created_at,
    }));
  }

  async findOne(id: string) {
    const admin = await this.prisma.admin_users.findUnique({
      where: { id },
      include: { admin_roles: true },
    });

    if (!admin) throw new NotFoundException('Admin user not found');

    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      phone: admin.phone,
      role: admin.admin_roles.name,
      display_name: admin.admin_roles.display_name,
      property_id: admin.property_id,
      is_active: admin.is_active,
      two_fa_enabled: admin.two_fa_enabled,
      last_login_at: admin.last_login_at,
      created_at: admin.created_at,
      updated_at: admin.updated_at,
    };
  }

  async deactivate(id: string, actor: AdminJwtPayload) {
    const admin = await this.prisma.admin_users.findUnique({ where: { id } });
    if (!admin) throw new NotFoundException('Admin user not found');

    await this.prisma.admin_users.update({
      where: { id },
      data: { is_active: false, updated_at: new Date() },
    });

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: actor.admin_id,
        action: 'ADMIN_DEACTIVATE',
        entity_type: 'admin_users',
        entity_id: id,
        old_value: { is_active: true },
        new_value: { is_active: false },
      },
    });

    // Invalidate JWT cache so the deactivated admin is rejected immediately
    await this.cacheService.invalidateAdminJwt(id);

    return { message: 'Admin user deactivated successfully' };
  }

  async updateProfile(
    id: string,
    dto: UpdateAdminProfileDto,
    actor: AdminJwtPayload,
  ) {
    const target = await this.prisma.admin_users.findUnique({
      where: { id },
      include: { admin_roles: true },
    });
    if (!target) throw new NotFoundException('Admin user not found');

    const isSelf = actor.admin_id === id;

    if (!isSelf) {
      // Hierarchy check: actor must outrank target
      const allowedTargets = ROLE_HIERARCHY[actor.role] ?? [];
      if (!allowedTargets.includes(target.admin_roles.name)) {
        throw new ForbiddenException(
          `You cannot edit a ${target.admin_roles.name} account`,
        );
      }
    }

    // Build update payload
    const data: Record<string, unknown> = { updated_at: new Date() };

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone || null;

    if (dto.email !== undefined) {
      const clash = await this.prisma.admin_users.findFirst({
        where: { email: dto.email, id: { not: id } },
      });
      if (clash) throw new ConflictException('Email already in use');
      data.email = dto.email;
    }

    if (dto.new_password) {
      if (isSelf) {
        // Self-service password change requires the old password
        if (!dto.current_password) {
          throw new BadRequestException(
            'current_password is required to change your password',
          );
        }
        const valid = await bcrypt.compare(
          dto.current_password,
          target.password_hash,
        );
        if (!valid) {
          throw new UnauthorizedException('Current password is incorrect');
        }
      }
      data.password_hash = await bcrypt.hash(dto.new_password, 12);
    }

    const updated = await this.prisma.admin_users.update({
      where: { id },
      data,
      include: { admin_roles: true },
    });

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: actor.admin_id,
        action: isSelf ? 'SELF_PROFILE_UPDATE' : 'ADMIN_PROFILE_UPDATE',
        entity_type: 'admin_users',
        entity_id: id,
        new_value: {
          name: dto.name,
          email: dto.email,
          password_changed: !!dto.new_password,
        },
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      role: updated.admin_roles.name,
      display_name: updated.admin_roles.display_name,
      property_id: updated.property_id,
      is_active: updated.is_active,
      updated_at: updated.updated_at,
    };
  }

  async remove(id: string, actor: AdminJwtPayload) {
    if (actor.admin_id === id) {
      throw new ForbiddenException('You cannot delete your own account');
    }

    const target = await this.prisma.admin_users.findUnique({
      where: { id },
      include: { admin_roles: true },
    });
    if (!target) throw new NotFoundException('Admin user not found');

    const allowedTargets = ROLE_HIERARCHY[actor.role] ?? [];
    if (!allowedTargets.includes(target.admin_roles.name)) {
      throw new ForbiddenException(
        `You cannot delete a ${target.admin_roles.name} account`,
      );
    }

    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: 'ADMIN',
        actor_id: actor.admin_id,
        action: 'ADMIN_DELETE',
        entity_type: 'admin_users',
        entity_id: id,
        old_value: { email: target.email, role: target.admin_roles.name },
      },
    });

    await this.prisma.admin_users.delete({ where: { id } });

    // Invalidate JWT cache
    await this.cacheService.invalidateAdminJwt(id);

    return { message: 'Admin user deleted successfully' };
  }

  async listRoles() {
    return this.prisma.admin_roles.findMany({
      where: { is_active: true },
      select: {
        id: true,
        name: true,
        display_name: true,
        permissions: true,
      },
      orderBy: { name: 'asc' },
    });
  }
}
