import { Module } from '@nestjs/common';
import { GuestKycService } from './guest-kyc.service';
import { GuestKycController } from './guest-kyc.controller';

@Module({
  controllers: [GuestKycController],
  providers: [GuestKycService],
  exports: [GuestKycService],
})
export class GuestKycModule {}
