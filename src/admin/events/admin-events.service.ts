import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../aws/s3.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { v4 as uuidv4 } from 'uuid';
import type { AdminJwtPayload } from '../../common/guards/admin-jwt.strategy';

@Injectable()
export class AdminEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async createEvent(dto: CreateEventDto, actor: AdminJwtPayload) {
    const propertyId = actor.property_id ?? 'prop-bandra-001';
    const id = `evt-${uuidv4().slice(0, 8)}`;

    const event = await this.prisma.events.create({
      data: {
        id,
        property_id: propertyId,
        title: dto.title,
        description: dto.description ?? null,
        date: new Date(dto.date),
        time: dto.time ?? null,
        location: dto.location ?? null,
        capacity: dto.capacity ?? null,
        price_text: dto.price_text ?? null,
        contact_link: dto.contact_link ?? null,
        poster_url: dto.poster_url ?? null,
        badge_label: dto.badge_label ?? null,
        badge_color: dto.badge_color ?? null,
        created_by: actor.admin_id,
      },
    });

    await this.logActivity(actor.admin_id, 'EVENT_CREATE', event.id, null, dto);

    return event;
  }

  async listEvents(propertyId: string) {
    const events = await this.prisma.events.findMany({
      where: { property_id: propertyId },
      orderBy: { date: 'desc' },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events.map((e) => ({
      ...e,
      is_upcoming: new Date(e.date) >= today,
    }));
  }

  async getEvent(id: string) {
    const event = await this.prisma.events.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return { ...event, is_upcoming: new Date(event.date) >= today };
  }

  async updateEvent(id: string, dto: UpdateEventDto, actor: AdminJwtPayload) {
    const existing = await this.prisma.events.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Event not found');

    const data: Record<string, unknown> = { updated_at: new Date() };
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.time !== undefined) data.time = dto.time;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.price_text !== undefined) data.price_text = dto.price_text;
    if (dto.contact_link !== undefined) data.contact_link = dto.contact_link;
    if (dto.poster_url !== undefined) data.poster_url = dto.poster_url;
    if (dto.badge_label !== undefined) data.badge_label = dto.badge_label;
    if (dto.badge_color !== undefined) data.badge_color = dto.badge_color;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;

    const updated = await this.prisma.events.update({ where: { id }, data });

    await this.logActivity(actor.admin_id, 'EVENT_UPDATE', id, existing, dto);

    return updated;
  }

  async deleteEvent(id: string, actor: AdminJwtPayload) {
    const existing = await this.prisma.events.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Event not found');

    await this.prisma.events.delete({ where: { id } });

    await this.logActivity(actor.admin_id, 'EVENT_DELETE', id, existing, null);

    return { message: 'Event deleted' };
  }

  async uploadPoster(file: Express.Multer.File, actor: AdminJwtPayload) {
    const propertyId = actor.property_id ?? 'prop-bandra-001';
    return this.s3.uploadFile(
      `events/${propertyId}`,
      file.originalname,
      file.mimetype,
      file.buffer,
    );
  }

  // Public methods (no auth)

  async listPublicEvents(propertyId: string, filter?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where: Record<string, unknown> = {
      property_id: propertyId,
      is_active: true,
    };

    if (filter === 'upcoming') {
      where.date = { gte: today };
    } else if (filter === 'past') {
      where.date = { lt: today };
    }

    const events = await this.prisma.events.findMany({
      where,
      orderBy: { date: filter === 'past' ? 'desc' : 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        date: true,
        time: true,
        location: true,
        capacity: true,
        price_text: true,
        contact_link: true,
        poster_url: true,
        badge_label: true,
        badge_color: true,
      },
    });

    return events.map((e) => ({
      ...e,
      is_upcoming: new Date(e.date) >= today,
    }));
  }

  async getPublicEvent(id: string) {
    const event = await this.prisma.events.findFirst({
      where: { id, is_active: true },
      select: {
        id: true,
        title: true,
        description: true,
        date: true,
        time: true,
        location: true,
        capacity: true,
        price_text: true,
        contact_link: true,
        poster_url: true,
        badge_label: true,
        badge_color: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return { ...event, is_upcoming: new Date(event.date) >= today };
  }

  private async logActivity(
    actorId: string,
    action: string,
    entityId: string,
    oldValue: unknown,
    newValue: unknown,
  ) {
    try {
      await this.prisma.admin_activity_log.create({
        data: {
          id: uuidv4(),
          actor_type: 'ADMIN',
          actor_id: actorId,
          action,
          entity_type: 'events',
          entity_id: entityId,
          old_value: oldValue ? JSON.parse(JSON.stringify(oldValue)) : undefined,
          new_value: newValue ? JSON.parse(JSON.stringify(newValue)) : undefined,
        },
      });
    } catch { /* non-critical */ }
  }
}
