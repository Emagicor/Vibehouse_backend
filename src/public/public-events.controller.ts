import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminEventsService } from '../admin/events/admin-events.service';
import { S3Service } from '../aws/s3.service';

@Controller('public/events')
export class PublicEventsController {
  constructor(
    private readonly eventsService: AdminEventsService,
    private readonly s3: S3Service,
  ) {}

  @Get('poster')
  async getPoster(
    @Query('key') key: string,
    @Res() res: Response,
  ) {
    if (!key || !key.startsWith('events/')) {
      throw new BadRequestException('Invalid or missing key');
    }

    try {
      const { stream, contentType } = await this.s3.getObjectStream(key);
      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      });
      stream.pipe(res);
    } catch (err: any) {
      if (err.name === 'NoSuchKey') {
        throw new NotFoundException('Poster not found');
      }
      throw err;
    }
  }

  @Get()
  listPublicEvents(
    @Query('property_id') propertyId: string,
    @Query('filter') filter?: string,
  ) {
    return this.eventsService.listPublicEvents(
      propertyId || 'prop-koramangala-a',
      filter,
    );
  }

  @Get(':id')
  getPublicEvent(@Param('id') id: string) {
    return this.eventsService.getPublicEvent(id);
  }
}
