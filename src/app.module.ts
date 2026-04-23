import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SqsModule } from './sqs/sqs.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AwsModule } from './aws/aws.module';
import { AdminAuthModule } from './admin/auth/admin-auth.module';
import { AdminUsersModule } from './admin/users/admin-users.module';
import { GuestAuthModule } from './guest/auth/guest-auth.module';
import { AdminInventoryModule } from './admin/inventory/admin-inventory.module';
import { AdminKycModule } from './admin/kyc/admin-kyc.module';
import { AdminBookingsModule } from './admin/bookings/admin-bookings.module';
import { GuestStoreModule } from './guest/store/guest-store.module';
import { GuestBookingModule } from './guest/booking/guest-booking.module';
import { GuestKycModule } from './guest/kyc/guest-kyc.module';
import { ColiveModule } from './guest/colive/colive.module';
import { PaymentModule } from './payment/payment.module';
import { AdminEventsModule } from './admin/events/admin-events.module';
import { AdminRoomTypesModule } from './admin/room-types/admin-room-types.module';
import { PublicModule } from './public/public.module';
import { EmailModule } from './email/email.module';
import { EzeeModule } from './ezee/ezee.module';

@Module({
  controllers: [AppController],
  providers: [AppService],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    AwsModule,
    EzeeModule,
    AdminAuthModule,
    AdminUsersModule,
    GuestAuthModule,
    AdminInventoryModule,
    AdminKycModule,
    AdminBookingsModule,
    AdminEventsModule,
    AdminRoomTypesModule,
    GuestStoreModule,
    GuestBookingModule,
    GuestKycModule,
    ColiveModule,
    PaymentModule,
    PublicModule,
    SqsModule,
    EmailModule,
  ],
})
export class AppModule {}


