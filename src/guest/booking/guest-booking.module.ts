import { Module } from '@nestjs/common';
import { GuestBookingService } from './guest-booking.service';
import { GuestBookingController } from './guest-booking.controller';
import { EzeeModule } from '../../ezee/ezee.module';

@Module({
  imports: [EzeeModule],
  controllers: [GuestBookingController],
  providers: [GuestBookingService],
  exports: [GuestBookingService],
})
export class GuestBookingModule {}
