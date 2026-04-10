import {
  Controller,
  Post,
  Body,
  Req,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { GuestJwtGuard } from '../common/guards/guest-jwt.guard';
import { CurrentGuest } from '../common/decorators/current-guest.decorator';
import type { GuestJwtPayload } from '../common/guards/guest-jwt.strategy';
import { PaymentService } from './payment.service';
import { CreatePaymentOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';

@Controller()
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  // ─── GUEST ENDPOINTS ────────────────────────────────────────────────────────

  /**
   * POST /payment/create-order
   * Creates a Razorpay order for the guest's PENDING addon cart.
   */
  @UseGuards(GuestJwtGuard)
  @Post('payment/create-order')
  createOrder(
    @CurrentGuest() guest: GuestJwtPayload,
    @Body() dto: CreatePaymentOrderDto,
  ) {
    return this.paymentService.createOrder(guest, dto.ezee_reservation_id);
  }

  /**
   * POST /payment/create-booking-order
   * Creates a Razorpay order for a new booking (rooms + addons).
   * Called after POST /guest/booking/create-order returns the booking summary.
   */
  @UseGuards(GuestJwtGuard)
  @Post('payment/create-booking-order')
  createBookingPayment(
    @CurrentGuest() guest: GuestJwtPayload,
    @Body() dto: { ezee_reservation_id: string; grand_total: number; addon_order_id?: string },
  ) {
    return this.paymentService.createBookingPayment(
      guest,
      dto.ezee_reservation_id,
      dto.grand_total,
      dto.addon_order_id ?? null,
    );
  }

  /**
   * POST /payment/verify
   * Frontend calls this after Razorpay checkout modal succeeds.
   */
  @UseGuards(GuestJwtGuard)
  @Post('payment/verify')
  verifyPayment(
    @CurrentGuest() guest: GuestJwtPayload,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.paymentService.verifyPayment(
      guest,
      dto.razorpay_order_id,
      dto.razorpay_payment_id,
      dto.razorpay_signature,
    );
  }

  // ─── WEBHOOK (no auth — Razorpay server-to-server) ──────────────────────────

  /**
   * POST /webhook/razorpay
   * Razorpay calls this on payment.captured, order.paid, payment.failed.
   * Signature verified internally.
   */
  @Post('webhook/razorpay')
  async handleWebhook(
    @Req() req: any,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    // Use raw body for signature verification
    const rawBody = req.rawBody
      ? req.rawBody.toString('utf8')
      : JSON.stringify(req.body);

    return this.paymentService.handleWebhook(rawBody, signature);
  }

  // ─── PAYMENT FAILURE ─────────────────────────────────────────────────────────

  /**
   * POST /payment/fail
   * Marks a payment as failed and unlinks from order so guest can retry.
   */
  @UseGuards(GuestJwtGuard)
  @Post('payment/fail')
  handlePaymentFailure(@Body('razorpay_order_id') razorpayOrderId: string) {
    return this.paymentService.handlePaymentFailure(razorpayOrderId);
  }

  // ─── DEV SIMULATE (development only) ───────────────────────────────────────

  /**
   * POST /payment/dev/simulate-capture
   * Simulates a Razorpay payment capture for local testing.
   * Only available when NODE_ENV=development.
   */
  @Post('payment/dev/simulate-capture')
  devSimulateCapture(@Body('razorpay_order_id') razorpayOrderId: string) {
    return this.paymentService.devSimulateCapture(razorpayOrderId);
  }

  /**
   * POST /payment/dev/simulate-fail
   * Simulates a Razorpay payment failure for local testing.
   * Only available when NODE_ENV=development.
   */
  @Post('payment/dev/simulate-fail')
  devSimulateFail(@Body('razorpay_order_id') razorpayOrderId: string) {
    return this.paymentService.devSimulateFail(razorpayOrderId);
  }

  // ─── COLIVE ENDPOINTS ────────────────────────────────────────────────────────

  /**
   * POST /payment/create-colive-order
   * Creates a Razorpay order for a long-stay (colive) draft booking.
   */
  @UseGuards(GuestJwtGuard)
  @Post('payment/create-colive-order')
  createColiveOrder(
    @CurrentGuest() guest: GuestJwtPayload,
    @Body() dto: { draft_booking_id: string; grand_total: number; currency?: string },
  ) {
    return this.paymentService.createColiveOrder(
      guest,
      dto.draft_booking_id,
      dto.grand_total,
      dto.currency ?? 'INR',
    );
  }

  /**
   * POST /payment/verify-colive
   * Verifies payment signature and confirms the colive booking.
   * Fires eZee SQS sync job.
   */
  @UseGuards(GuestJwtGuard)
  @Post('payment/verify-colive')
  verifyColivePayment(
    @CurrentGuest() guest: GuestJwtPayload,
    @Body() dto: {
      draft_booking_id: string;
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    },
  ) {
    return this.paymentService.verifyColivePayment(
      guest,
      dto.draft_booking_id,
      dto.razorpay_order_id,
      dto.razorpay_payment_id,
      dto.razorpay_signature,
    );
  }
}
