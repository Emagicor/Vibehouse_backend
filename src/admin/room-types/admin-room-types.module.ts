import { Module } from '@nestjs/common';
import { AdminRoomTypesController } from './admin-room-types.controller';
import { AdminRoomTypesService } from './admin-room-types.service';

@Module({
  controllers: [AdminRoomTypesController],
  providers: [AdminRoomTypesService],
})
export class AdminRoomTypesModule {}
