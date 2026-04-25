import { Module } from '@nestjs/common';
import { EzeeService } from './ezee.service';
import { EzeeReconciliationService } from './ezee-reconciliation.service';
import { MyGateModule } from '../mygate/mygate.module';

@Module({
  imports: [MyGateModule],
  providers: [EzeeService, EzeeReconciliationService],
  exports: [EzeeService, EzeeReconciliationService],
})
export class EzeeModule {}
