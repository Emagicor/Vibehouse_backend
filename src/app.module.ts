import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AwsModule } from './aws/aws.module';
import { AdminAuthModule } from './admin/auth/admin-auth.module';
import { AdminUsersModule } from './admin/users/admin-users.module';
import { GuestAuthModule } from './guest/auth/guest-auth.module';
import { AdminInventoryModule } from './admin/inventory/admin-inventory.module';
import { AdminKycModule } from './admin/kyc/admin-kyc.module';
import { GuestStoreModule } from './guest/store/guest-store.module';
import { GuestBookingModule } from './guest/booking/guest-booking.module';
import { GuestKycModule } from './guest/kyc/guest-kyc.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    AwsModule,
    AdminAuthModule,
    AdminUsersModule,
    GuestAuthModule,
    AdminInventoryModule,
    AdminKycModule,
    GuestStoreModule,
    GuestBookingModule,
    GuestKycModule,
  ],
})
export class AppModule {}

