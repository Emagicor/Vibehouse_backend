import { Module } from '@nestjs/common';
import { AdminInventoryService } from './admin-inventory.service';
import { AdminInventoryController } from './admin-inventory.controller';

@Module({
  controllers: [AdminInventoryController],
  providers: [AdminInventoryService],
  exports: [AdminInventoryService],
})
export class AdminInventoryModule {}
