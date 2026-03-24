import { Module } from '@nestjs/common';
import { PublicEventsController } from './public-events.controller';
import { AdminEventsModule } from '../admin/events/admin-events.module';

@Module({
  imports: [AdminEventsModule],
  controllers: [PublicEventsController],
})
export class PublicModule {}
