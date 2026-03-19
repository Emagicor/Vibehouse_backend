import { Global, Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { TextractService } from './textract.service';

@Global()
@Module({
  providers: [S3Service, TextractService],
  exports: [S3Service, TextractService],
})
export class AwsModule {}
