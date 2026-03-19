import { Module } from '@nestjs/common';
import { GuestBookingService } from './guest-booking.service';
import { GuestBookingController } from './guest-booking.controller';

@Module({
  controllers: [GuestBookingController],
  providers: [GuestBookingService],
  exports: [GuestBookingService],
})
export class GuestBookingModule {}
