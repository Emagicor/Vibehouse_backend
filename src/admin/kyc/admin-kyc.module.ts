import { Module } from '@nestjs/common';
import { AdminKycService } from './admin-kyc.service';
import { AdminKycController } from './admin-kyc.controller';

// PrismaService and S3Service are provided by @Global() PrismaModule and AwsModule
@Module({
  controllers: [AdminKycController],
  providers: [AdminKycService],
})
export class AdminKycModule {}
