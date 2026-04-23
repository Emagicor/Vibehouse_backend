import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateColivePriceDto } from './dto/update-colive-price.dto';

@Injectable()
export class AdminRoomTypesService {
  private readonly logger = new Logger(AdminRoomTypesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listRoomTypes(propertyId?: string) {
    const roomTypes = await this.prisma.room_types.findMany({
      where: {
        is_active: true,
        ...(propertyId ? { property_id: propertyId } : {}),
      },
      select: {
        id: true,
        property_id: true,
        name: true,
        slug: true,
        type: true,
        total_beds: true,
        base_price_per_night: true,
        colive_price_month: true,
        ezee_room_type_id: true,
        properties: { select: { name: true } },
      },
      orderBy: [{ property_id: 'asc' }, { base_price_per_night: 'asc' }],
    });

    return roomTypes.map((rt) => ({
      id: rt.id,
      property_id: rt.property_id,
      property_name: rt.properties.name,
      name: rt.name,
      slug: rt.slug,
      type: rt.type,
      total_beds: rt.total_beds,
      base_price_per_night: Number(rt.base_price_per_night),
      colive_price_month: rt.colive_price_month ? Number(rt.colive_price_month) : null,
      ezee_room_type_id: rt.ezee_room_type_id,
    }));
  }

  async updateColivePrice(roomTypeId: string, dto: UpdateColivePriceDto) {
    const existing = await this.prisma.room_types.findFirst({
      where: { id: roomTypeId, is_active: true },
    });

    if (!existing) {
      throw new NotFoundException(`Room type "${roomTypeId}" not found`);
    }

    const updated = await this.prisma.room_types.update({
      where: { id: roomTypeId },
      data: { colive_price_month: dto.colive_price_month },
      select: {
        id: true,
        name: true,
        slug: true,
        colive_price_month: true,
      },
    });

    this.logger.log(
      `Colive price updated: ${roomTypeId} → ₹${dto.colive_price_month}/month`,
    );

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      colive_price_month: Number(updated.colive_price_month),
    };
  }
}
