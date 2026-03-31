import { Module } from '@nestjs/common';
import { EzeeService } from './ezee.service';
import { EzeeReconciliationService } from './ezee-reconciliation.service';

@Module({
  providers: [EzeeService, EzeeReconciliationService],
  exports: [EzeeService],
})
export class EzeeModule {}
