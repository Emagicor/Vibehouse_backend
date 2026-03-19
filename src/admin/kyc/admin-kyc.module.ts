import { Module } from '@nestjs/common';
import { AdminKycService } from './admin-kyc.service';
import { AdminKycController } from './admin-kyc.controller';

@Module({
  controllers: [AdminKycController],
  providers: [AdminKycService],
})
export class AdminKycModule {}
