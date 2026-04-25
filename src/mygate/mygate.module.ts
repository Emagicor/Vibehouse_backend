import { Module } from '@nestjs/common';
import { MyGateService } from './mygate.service';

@Module({
  providers: [MyGateService],
  exports: [MyGateService],
})
export class MyGateModule {}
