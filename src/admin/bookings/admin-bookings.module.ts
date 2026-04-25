import { Module } from '@nestjs/common';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';
import { EzeeModule } from '../../ezee/ezee.module';

@Module({
  imports: [EzeeModule],
  controllers: [AdminBookingsController],
  providers: [AdminBookingsService],
  exports: [AdminBookingsService],
})
export class AdminBookingsModule {}
