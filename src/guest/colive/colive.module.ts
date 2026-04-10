import { Module } from '@nestjs/common';
import { ColiveService } from './colive.service';
import { ColiveController } from './colive.controller';
import { EzeeModule } from '../../ezee/ezee.module';

@Module({
  imports: [EzeeModule],
  controllers: [ColiveController],
  providers: [ColiveService],
  exports: [ColiveService],
})
export class ColiveModule {}
