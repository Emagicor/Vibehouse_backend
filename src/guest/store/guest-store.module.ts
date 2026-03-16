import { Module } from '@nestjs/common';
import { GuestStoreController } from './guest-store.controller';
import { GuestStoreService } from './guest-store.service';

@Module({
  controllers: [GuestStoreController],
  providers: [GuestStoreService],
})
export class GuestStoreModule {}
