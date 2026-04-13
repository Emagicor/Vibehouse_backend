import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AdminEventsService } from './admin-events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '../../common/guards/admin-jwt.strategy';

@Controller('admin/events')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminEventsController {
  constructor(
    private readonly eventsService: AdminEventsService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @RequirePermission('events.edit')
  createEvent(
    @Body() dto: CreateEventDto,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.eventsService.createEvent(dto, actor);
  }

  @Get()
  @RequirePermission('events.view')
  listEvents(@CurrentAdmin() actor: AdminJwtPayload) {
    return this.eventsService.listEvents(actor.property_id ?? this.config.getOrThrow<string>('DEFAULT_PROPERTY_ID'));
  }

  @Get(':id')
  @RequirePermission('events.view')
  getEvent(@Param('id') id: string) {
    return this.eventsService.getEvent(id);
  }

  @Patch(':id')
  @RequirePermission('events.edit')
  updateEvent(
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.eventsService.updateEvent(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermission('events.edit')
  deleteEvent(
    @Param('id') id: string,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    return this.eventsService.deleteEvent(id, actor);
  }

  @Post('upload-poster')
  @RequirePermission('events.edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadPoster(
    @UploadedFile() file: Express.Multer.File,
    @CurrentAdmin() actor: AdminJwtPayload,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.eventsService.uploadPoster(file, actor);
  }
}
