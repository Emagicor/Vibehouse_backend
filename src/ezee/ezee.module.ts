import { Module } from '@nestjs/common';
import { EzeeService } from './ezee.service';

@Module({
  providers: [EzeeService],
  exports: [EzeeService],
})
export class EzeeModule {}
