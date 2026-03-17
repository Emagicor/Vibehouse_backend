import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AdminAuthModule } from './admin/auth/admin-auth.module';
import { AdminUsersModule } from './admin/users/admin-users.module';
import { GuestAuthModule } from './guest/auth/guest-auth.module';
import { AdminInventoryModule } from './admin/inventory/admin-inventory.module';
import { GuestStoreModule } from './guest/store/guest-store.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    AdminAuthModule,
    AdminUsersModule,
    GuestAuthModule,
    AdminInventoryModule,
    GuestStoreModule,
  ],
})
export class AppModule {}

