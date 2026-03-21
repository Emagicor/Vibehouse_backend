import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { RazorpayProvider } from './razorpay.provider';

@Module({
  controllers: [PaymentController],
  providers: [RazorpayProvider, PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
