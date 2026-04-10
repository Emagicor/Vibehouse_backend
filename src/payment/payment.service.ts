import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import Razorpay from 'razorpay';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { RAZORPAY } from './razorpay.provider';
import { SqsProducerService } from '../sqs/sqs-producer.service';
import type { GuestJwtPayload } from '../common/guards/guest-jwt.strategy';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    @Inject(RAZORPAY) private readonly razorpay: Razorpay,
    private readonly sqsProducer: SqsProducerService,
  ) {}

  // ─── STEP 1: CREATE RAZORPAY ORDER ─────────────────────────────────────────

  /**
   * Creates a Razorpay order for a guest's PENDING addon cart.
   * Returns the razorpay_order_id + key for the frontend to open the checkout modal.
   */
  async createOrder(guest: GuestJwtPayload, eri: string) {
    // Verify booking access
    const booking = await this.verifyBookingAccess(guest.guest_id, eri);

    // Find PENDING cart
    const cart = await this.prisma.addon_orders.findFirst({
      where: {
        ezee_reservation_id: eri,
        guest_id: guest.guest_id,
        status: 'PENDING',
      },
      include: {
        addon_order_items: { include: { product_catalog: true } },
      },
    });

    if (!cart || cart.addon_order_items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // If cart has a linked payment that's FAILED or CREATED (expired), unlink it
    if (cart.payment_id) {
      const existingPayment = await this.prisma.payments.findUnique({
        where: { id: cart.payment_id },
      });
      if (existingPayment && existingPayment.status !== 'CAPTURED') {
        await this.prisma.addon_orders.update({
          where: { id: cart.id },
          data: { payment_id: null },
        });
      } else if (existingPayment?.status === 'CAPTURED') {
        throw new BadRequestException('This cart has already been paid for');
      }
    }

    // Calculate total
    const totalAmount = cart.addon_order_items.reduce(
      (sum, i) => sum + Number(i.total_price),
      0,
    );

    if (totalAmount <= 0) {
      throw new BadRequestException('Cart total must be greater than zero');
    }

    // Stock validation
    for (const item of cart.addon_order_items) {
      if (item.product_catalog.category === 'COMMODITY') {
        const inv = await this.prisma.inventory.findFirst({
          where: { product_id: item.product_id, property_id: booking.property_id },
        });
        if (!inv || inv.available_stock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for "${item.product_catalog.name}". Available: ${inv?.available_stock ?? 0}`,
          );
        }
      }
    }

    // Create Razorpay order (amount in paise)
    const rzpOrder = await this.razorpay.orders.create({
      amount: Math.round(totalAmount * 100),
      currency: 'INR',
      receipt: cart.id,
      notes: {
        addon_order_id: cart.id,
        guest_id: guest.guest_id,
        ezee_reservation_id: eri,
      },
    });

    // Create PENDING payment record in our DB
    const paymentId = uuidv4();
    await this.prisma.payments.create({
      data: {
        id: paymentId,
        ezee_reservation_id: eri,
        guest_id: guest.guest_id,
        razorpay_order_id: rzpOrder.id,
        amount: totalAmount,
        currency: 'INR',
        purpose: 'addon_upsell',
        status: 'CREATED',
        expires_at: new Date(Date.now() + 30 * 60 * 1000), // 30 min expiry
      },
    });

    // Link payment to the addon order
    await this.prisma.addon_orders.update({
      where: { id: cart.id },
      data: { payment_id: paymentId },
    });

    // Async audit log via SQS
    await this.sqsProducer.sendAuditLog({
      actor_type: 'GUEST',
      actor_id: guest.guest_id,
      action: 'PAYMENT_CREATED',
      entity_type: 'payment',
      entity_id: paymentId,
      new_value: {
        razorpay_order_id: rzpOrder.id,
        amount: totalAmount,
        addon_order_id: cart.id,
        eri,
      },
    });

    return {
      razorpay_order_id: rzpOrder.id,
      razorpay_key: process.env.RAZORPAY_TEST_API_KEY,
      amount: totalAmount,
      amount_paise: Math.round(totalAmount * 100),
      currency: 'INR',
      payment_id: paymentId,
      order_id: cart.id,
      guest: {
        email: guest.email,
      },
    };
  }

  // ─── STEP 1B: CREATE RAZORPAY ORDER FOR BOOKING ────────────────────────────

  /**
   * Creates a Razorpay order for a booking (rooms + addons).
   * Called after createBookingOrder has created the pending records.
   */
  async createBookingPayment(
    guest: GuestJwtPayload,
    eri: string,
    grandTotal: number,
    addonOrderId: string | null,
  ) {
    if (grandTotal <= 0) {
      throw new BadRequestException('Booking total must be greater than zero');
    }

    // Create Razorpay order
    const rzpOrder = await (this.razorpay.orders.create({
      amount: Math.round(grandTotal * 100),
      currency: 'INR',
      receipt: eri,
      notes: {
        type: 'booking',
        ezee_reservation_id: eri,
        guest_id: guest.guest_id,
        addon_order_id: addonOrderId ?? '',
      },
    }) as any as Promise<{ id: string }>);

    // Create payment record
    const paymentId = uuidv4();
    await this.prisma.payments.create({
      data: {
        id: paymentId,
        ezee_reservation_id: eri,
        guest_id: guest.guest_id,
        razorpay_order_id: rzpOrder.id,
        amount: grandTotal,
        currency: 'INR',
        purpose: 'booking',
        status: 'CREATED',
        expires_at: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    // Link payment to addon order if exists
    if (addonOrderId) {
      await this.prisma.addon_orders.update({
        where: { id: addonOrderId },
        data: { payment_id: paymentId },
      });
    }

    // Async audit log via SQS
    await this.sqsProducer.sendAuditLog({
      actor_type: 'GUEST',
      actor_id: guest.guest_id,
      action: 'BOOKING_PAYMENT_CREATED',
      entity_type: 'payment',
      entity_id: paymentId,
      new_value: {
        razorpay_order_id: rzpOrder.id,
        amount: grandTotal,
        eri,
        type: 'booking',
      },
    });

    return {
      razorpay_order_id: rzpOrder.id,
      razorpay_key: process.env.RAZORPAY_TEST_API_KEY,
      amount: grandTotal,
      amount_paise: Math.round(grandTotal * 100),
      currency: 'INR',
      payment_id: paymentId,
      ezee_reservation_id: eri,
      guest: { email: guest.email },
    };
  }

  // ─── STEP 2: VERIFY PAYMENT (frontend callback) ────────────────────────────

  /**
   * Frontend calls this after Razorpay checkout modal succeeds.
   * Verifies the signature and fulfils the order.
   */
  async verifyPayment(
    guest: GuestJwtPayload,
    razorpay_order_id: string,
    razorpay_payment_id: string,
    razorpay_signature: string,
  ) {
    // Verify signature
    const expectedSig = createHmac('sha256', process.env.RAZORPAY_TEST_API_SECRET!)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      this.logger.warn(`Invalid payment signature for order ${razorpay_order_id}`);
      throw new BadRequestException('Invalid payment signature');
    }

    // Find payment record
    const payment = await this.prisma.payments.findUnique({
      where: { razorpay_order_id },
    });

    if (!payment) {
      throw new NotFoundException('Payment record not found');
    }

    if (payment.guest_id !== guest.guest_id) {
      throw new BadRequestException('Payment does not belong to this guest');
    }

    if (payment.status === 'CAPTURED') {
      return { message: 'Payment already captured', payment_id: payment.id };
    }

    // Fulfil the order
    return this.fulfilOrder(payment.id, razorpay_payment_id);
  }

  // ─── STEP 3: WEBHOOK (Razorpay server-to-server) ───────────────────────────

  /**
   * Razorpay webhook handler. Verifies webhook signature and processes events.
   * Handles: payment.captured, order.paid, payment.failed
   */
  async handleWebhook(rawBody: string, signature: string) {
    // Verify webhook signature
    const expectedSig = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest('hex');

    if (expectedSig !== signature) {
      this.logger.warn('Invalid webhook signature');
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = JSON.parse(rawBody);
    this.logger.log(`Webhook event received: ${event.event}`);

    switch (event.event) {
      case 'payment.captured':
      case 'order.paid': {
        const rzpPaymentId =
          event.payload?.payment?.entity?.id ??
          event.payload?.order?.entity?.payments?.items?.[0]?.id;
        const rzpOrderId =
          event.payload?.payment?.entity?.order_id ??
          event.payload?.order?.entity?.id;

        if (!rzpOrderId) {
          this.logger.warn('Webhook missing order_id');
          return { status: 'ignored', reason: 'missing order_id' };
        }

        const payment = await this.prisma.payments.findUnique({
          where: { razorpay_order_id: rzpOrderId },
        });

        if (!payment) {
          this.logger.warn(`No payment record for razorpay order ${rzpOrderId}`);
          return { status: 'ignored', reason: 'payment not found' };
        }

        if (payment.status === 'CAPTURED') {
          return { status: 'already_captured' };
        }

        await this.fulfilOrder(payment.id, rzpPaymentId);
        return { status: 'captured' };
      }

      case 'payment.failed': {
        const rzpOrderId = event.payload?.payment?.entity?.order_id;
        if (rzpOrderId) {
          await this.handlePaymentFailure(rzpOrderId);
        }
        return { status: 'failed_recorded' };
      }

      default:
        this.logger.log(`Unhandled webhook event: ${event.event}`);
        return { status: 'ignored', reason: 'unhandled event' };
    }
  }

  // ─── DEV SIMULATE (local testing only) ──────────────────────────────────────

  /**
   * Simulates a successful payment capture for local dev testing.
   * Only works when NODE_ENV=development.
   */
  async devSimulateCapture(razorpay_order_id: string) {
    if (process.env.NODE_ENV !== 'development') {
      throw new BadRequestException('Dev simulate only available in development');
    }

    const payment = await this.prisma.payments.findUnique({
      where: { razorpay_order_id },
    });

    if (!payment) {
      throw new NotFoundException('Payment record not found');
    }

    if (payment.status === 'CAPTURED') {
      return { message: 'Already captured', payment_id: payment.id };
    }

    const simPaymentId = `sim_pay_${uuidv4().slice(0, 12)}`;
    return this.fulfilOrder(payment.id, simPaymentId);
  }

  // ─── PAYMENT FAILURE ─────────────────────────────────────────────────────────

  /**
   * Handles a failed payment: marks payment FAILED, unlinks it from the order,
   * so the guest can retry checkout with a new Razorpay order.
   */
  async handlePaymentFailure(razorpay_order_id: string) {
    const payment = await this.prisma.payments.findUnique({
      where: { razorpay_order_id },
    });

    if (!payment) throw new NotFoundException('Payment record not found');

    if (payment.status === 'CAPTURED') {
      return { message: 'Payment already captured — cannot mark as failed', payment_id: payment.id };
    }

    if (payment.status === 'FAILED') {
      return { message: 'Payment already marked as failed', payment_id: payment.id };
    }

    // Mark payment as FAILED
    await this.prisma.payments.update({
      where: { id: payment.id },
      data: { status: 'FAILED', updated_at: new Date() },
    });

    // For booking payments: rollback the entire pending booking
    if (payment.purpose === 'booking') {
      await this.rollbackPendingBooking(payment.ezee_reservation_id);
      // Log failure
      await this.sqsProducer.sendAuditLog({
        actor_type: 'SYSTEM',
        actor_id: payment.guest_id,
        action: 'BOOKING_PAYMENT_FAILED',
        entity_type: 'payment',
        entity_id: payment.id,
        new_value: {
          razorpay_order_id,
          amount: Number(payment.amount),
          eri: payment.ezee_reservation_id,
        },
      });
      this.logger.log(`Booking payment ${payment.id} failed — pending booking ${payment.ezee_reservation_id} rolled back`);
      return {
        message: 'Booking payment failed. Pending booking rolled back. You can try again.',
        payment_id: payment.id,
        razorpay_order_id,
      };
    }

    // For addon payments: unlink from order so guest can retry
    await this.prisma.addon_orders.updateMany({
      where: { payment_id: payment.id, status: 'PENDING' },
      data: { payment_id: null },
    });

    // Async audit log via SQS
    await this.sqsProducer.sendAuditLog({
      actor_type: 'SYSTEM',
      actor_id: payment.guest_id,
      action: 'PAYMENT_FAILED',
      entity_type: 'payment',
      entity_id: payment.id,
      new_value: {
        razorpay_order_id,
        amount: Number(payment.amount),
      },
    });

    this.logger.log(`Payment ${payment.id} (${razorpay_order_id}) marked FAILED, order unlinked for retry`);

    return {
      message: 'Payment failed. Cart is available for retry.',
      payment_id: payment.id,
      razorpay_order_id,
    };
  }

  /**
   * Dev-only: simulate a payment failure for testing.
   */
  async devSimulateFail(razorpay_order_id: string) {
    if (process.env.NODE_ENV !== 'development') {
      throw new BadRequestException('Dev simulate only available in development');
    }
    return this.handlePaymentFailure(razorpay_order_id);
  }

  // ─── INTERNAL: FULFIL ORDER ──────────────────────────────────────────────────

  /**
   * Core fulfilment logic — shared by verify, webhook, and dev-simulate.
   * Wrapped in a Prisma interactive transaction with row-level locks on inventory
   * to prevent race conditions (e.g., 2 guests paying for the last towel).
   *
   * Flow:
   *   1. SELECT ... FOR UPDATE on inventory rows (locks them for this transaction)
   *   2. Validate stock is still sufficient
   *   3. Decrement stock
   *   4. Mark payment CAPTURED + order PAID
   *   5. Log activity
   *   6. Commit (releases locks)
   */
  private async fulfilOrder(paymentId: string, razorpayPaymentId: string) {
    const payment = await this.prisma.payments.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    // Idempotency — already captured
    if (payment.status === 'CAPTURED') {
      return { message: 'Payment already captured', payment_id: payment.id };
    }

    // ─── BOOKING PAYMENT (rooms + addons) ───
    if (payment.purpose === 'booking') {
      return this.fulfilBookingOrder({
        id: payment.id,
        ezee_reservation_id: payment.ezee_reservation_id,
        guest_id: payment.guest_id,
        razorpay_order_id: payment.razorpay_order_id ?? '',
        amount: payment.amount,
      }, razorpayPaymentId);
    }

    // ─── ADDON PAYMENT (post-booking upsell) ───
    const order = await this.prisma.addon_orders.findFirst({
      where: { payment_id: paymentId },
      include: {
        addon_order_items: { include: { product_catalog: true } },
      },
    });
    if (!order) {
      this.logger.warn(`No addon order linked to payment ${paymentId}`);
      throw new NotFoundException('Order not found for this payment');
    }

    const booking = await this.prisma.ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: payment.ezee_reservation_id },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    // Collect commodity items that need stock decrement
    const commodityItems = order.addon_order_items.filter(
      (i) => i.product_catalog.category === 'COMMODITY',
    );

    // Run everything inside a serializable transaction with row-level locks
    const result = await this.prisma.$transaction(async (tx) => {
      // STEP 1: Lock inventory rows with SELECT ... FOR UPDATE
      // This prevents other transactions from reading/modifying these rows
      // until this transaction commits.
      if (commodityItems.length > 0) {
        const productIds = commodityItems.map((i) => i.product_id);

        // Raw query for FOR UPDATE — Prisma doesn't support it natively
        const lockedRows: { product_id: string; available_stock: number }[] =
          await tx.$queryRawUnsafe(
            `SELECT product_id, available_stock FROM inventory
             WHERE property_id = $1 AND product_id = ANY($2::text[])
             FOR UPDATE`,
            booking.property_id,
            productIds,
          );

        // STEP 2: Validate stock under the lock
        const stockMap = new Map(lockedRows.map((r) => [r.product_id, r.available_stock]));

        for (const item of commodityItems) {
          const available = stockMap.get(item.product_id) ?? 0;
          if (available < item.quantity) {
            // Stock insufficient — payment was captured by Razorpay but we can't fulfil.
            // Mark payment as REFUND_NEEDED (manual intervention required).
            await tx.payments.update({
              where: { id: paymentId },
              data: {
                razorpay_payment_id: razorpayPaymentId,
                status: 'REFUND_NEEDED',
                updated_at: new Date(),
              },
            });

            await tx.addon_orders.update({
              where: { id: order.id },
              data: { status: 'FAILED_STOCK' },
            });

            this.logger.error(
              `STOCK CONFLICT: "${item.product_catalog.name}" — needed ${item.quantity}, available ${available}. Payment ${paymentId} marked REFUND_NEEDED.`,
            );

            return {
              message: 'Payment received but insufficient stock. Refund will be processed.',
              payment_id: paymentId,
              order_id: order.id,
              conflict_item: item.product_catalog.name,
              needed: item.quantity,
              available,
              status: 'REFUND_NEEDED',
            };
          }
        }

        // STEP 3: Decrement stock (still under lock)
        for (const item of commodityItems) {
          await tx.inventory.updateMany({
            where: { product_id: item.product_id, property_id: booking.property_id },
            data: {
              available_stock: { decrement: item.quantity },
              sold_count: { increment: item.quantity },
            },
          });
        }
      }

      // STEP 4: Mark payment CAPTURED + order PAID
      await tx.payments.update({
        where: { id: paymentId },
        data: {
          razorpay_payment_id: razorpayPaymentId,
          status: 'CAPTURED',
          updated_at: new Date(),
        },
      });

      await tx.addon_orders.update({
        where: { id: order.id },
        data: { status: 'PAID' },
      });

      // STEP 5: Audit log moved outside transaction (goes to SQS)

      return null; // success — no conflict
    }, {
      timeout: 10000, // 10 second timeout for the transaction
    });

    // If the transaction returned a conflict result, return it
    if (result) return result;

    // Invalidate cache outside transaction
    await this.cacheService.invalidatePropertyCache(booking.property_id);

    // Async audit log + payment success event via SQS
    await this.sqsProducer.sendAuditLog({
      actor_type: 'GUEST',
      actor_id: payment.guest_id,
      action: 'PAYMENT_CAPTURED',
      entity_type: 'payment',
      entity_id: paymentId,
      new_value: {
        razorpay_order_id: payment.razorpay_order_id,
        razorpay_payment_id: razorpayPaymentId,
        amount: Number(payment.amount),
        order_id: order.id,
      },
    });

    await this.sqsProducer.sendPaymentSuccess({
      eri: payment.ezee_reservation_id,
      payment_id: paymentId,
      razorpay_payment_id: razorpayPaymentId,
      amount: Number(payment.amount),
      purpose: payment.purpose,
      guest_id: payment.guest_id,
      property_id: booking.property_id,
      items: order.addon_order_items.map((i) => ({
        product_name: i.product_catalog.name,
        quantity: i.quantity,
        total: Number(i.total_price),
      })),
    });

    // Emit to eZee sync queue — records addon charge in eZee folio
    await this.sqsProducer.sendEzeeAddExtraCharge({
      eri: payment.ezee_reservation_id,
      property_id: booking.property_id,
      items: order.addon_order_items.map((i) => ({
        product_name: i.product_catalog.name,
        quantity: i.quantity,
        amount: Number(i.total_price),
      })),
      razorpay_payment_id: razorpayPaymentId,
    });

    this.logger.log(`Order ${order.id} fulfilled — payment ${paymentId} captured`);

    return {
      message: 'Payment captured, order fulfilled',
      payment_id: paymentId,
      order_id: order.id,
      total: Number(payment.amount),
      items_count: order.addon_order_items.length,
    };
  }

  // ─── ROLLBACK PENDING BOOKING ────────────────────────────────────────────────

  /**
   * Rolls back a pending booking on payment failure.
   * Releases reserved inventory, deletes pending records.
   */
  private async rollbackPendingBooking(eri: string) {
    const booking = await this.prisma.ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: eri },
    });

    if (!booking || booking.status !== 'PENDING_PAYMENT') return;

    await this.prisma.$transaction(async (tx) => {
      // Release reserved addon inventory
      const addonOrder = await tx.addon_orders.findFirst({
        where: { ezee_reservation_id: eri, status: 'PENDING' },
        include: { addon_order_items: { include: { product_catalog: true } } },
      });

      if (addonOrder) {
        for (const item of addonOrder.addon_order_items) {
          if (item.product_catalog.category === 'COMMODITY') {
            await tx.inventory.updateMany({
              where: { product_id: item.product_id, property_id: booking.property_id },
              data: {
                available_stock: { increment: item.quantity },
                reserved_stock: { decrement: item.quantity },
              },
            });
          }
        }
        await tx.addon_order_items.deleteMany({ where: { addon_order_id: addonOrder.id } });
        await tx.addon_orders.delete({ where: { id: addonOrder.id } });
      }

      await tx.booking_slots.deleteMany({ where: { ezee_reservation_id: eri } });
      await tx.booking_guest_access.deleteMany({ where: { ezee_reservation_id: eri } });
      // Don't delete ezee_booking_cache — payments FK references it.
      // Mark as CANCELLED instead.
      await tx.ezee_booking_cache.update({
        where: { ezee_reservation_id: eri },
        data: { status: 'CANCELLED', is_active: false },
      });
    });

    this.logger.log(`Rolled back pending booking: ${eri}`);
  }

  // ─── FULFIL BOOKING ORDER ────────────────────────────────────────────────────

  /**
   * Handles booking payment fulfilment:
   * 1. Confirms the booking (PENDING_PAYMENT → CONFIRMED)
   * 2. Finalizes addon inventory (reserved → sold)
   * 3. Marks payment CAPTURED, addon order PAID
   */
  private async fulfilBookingOrder(
    payment: { id: string; ezee_reservation_id: string; guest_id: string; razorpay_order_id: string; amount: any },
    razorpayPaymentId: string,
  ) {
    const eri = payment.ezee_reservation_id;

    const booking = await this.prisma.ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: eri },
    });

    if (!booking) {
      throw new NotFoundException(`Booking ${eri} not found`);
    }

    // Already confirmed (idempotent)
    if (booking.status === 'CONFIRMED') {
      await this.prisma.payments.update({
        where: { id: payment.id },
        data: { razorpay_payment_id: razorpayPaymentId, status: 'CAPTURED', updated_at: new Date() },
      });
      return { message: 'Booking already confirmed', payment_id: payment.id, eri };
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Confirm booking
      await tx.ezee_booking_cache.update({
        where: { ezee_reservation_id: eri },
        data: { status: 'CONFIRMED' },
      });

      // 2. Finalize addon inventory (reserved → sold)
      const addonOrder = await tx.addon_orders.findFirst({
        where: { ezee_reservation_id: eri, status: 'PENDING' },
        include: { addon_order_items: { include: { product_catalog: true } } },
      });

      if (addonOrder) {
        for (const item of addonOrder.addon_order_items) {
          if (item.product_catalog.category === 'COMMODITY') {
            await tx.inventory.updateMany({
              where: { product_id: item.product_id, property_id: booking.property_id },
              data: {
                reserved_stock: { decrement: item.quantity },
                sold_count: { increment: item.quantity },
              },
            });
          }
        }
        await tx.addon_orders.update({
          where: { id: addonOrder.id },
          data: { status: 'PAID' },
        });
      }

      // 3. Mark payment CAPTURED
      await tx.payments.update({
        where: { id: payment.id },
        data: {
          razorpay_payment_id: razorpayPaymentId,
          status: 'CAPTURED',
          updated_at: new Date(),
        },
      });

      // 4. Audit log moved outside transaction (goes to SQS)
    }, { timeout: 10000 });

    // Invalidate cache
    await this.cacheService.invalidatePropertyCache(booking.property_id);

    // Async audit log + booking confirmed event via SQS
    await this.sqsProducer.sendAuditLog({
      actor_type: 'GUEST',
      actor_id: payment.guest_id,
      action: 'BOOKING_CONFIRMED',
      entity_type: 'booking',
      entity_id: eri,
      new_value: {
        razorpay_order_id: payment.razorpay_order_id,
        razorpay_payment_id: razorpayPaymentId,
        amount: Number(payment.amount),
        room_type: booking.room_type_name,
        checkin: booking.checkin_date,
        checkout: booking.checkout_date,
      },
    });

    await this.sqsProducer.sendBookingConfirmed({
      eri,
      payment_id: payment.id,
      guest_id: payment.guest_id,
      room_type: booking.room_type_name,
      checkin: booking.checkin_date,
      checkout: booking.checkout_date,
    });

    // Emit to eZee sync queue — creates booking in eZee PMS
    await this.sqsProducer.sendEzeeInsertBooking({
      eri,
      guest_id: payment.guest_id,
      property_id: booking.property_id,
      room_type: booking.room_type_name,
      checkin: booking.checkin_date?.toISOString().split('T')[0] ?? null,
      checkout: booking.checkout_date?.toISOString().split('T')[0] ?? null,
      amount: Number(payment.amount),
    });

    this.logger.log(`Booking ${eri} confirmed — payment ${payment.id} captured`);

    return {
      message: 'Booking confirmed, payment captured',
      payment_id: payment.id,
      ezee_reservation_id: eri,
      total: Number(payment.amount),
      status: 'CONFIRMED',
    };
  }

  // ─── HELPERS ────────────────────────────────────────────────────────────────

  private async verifyBookingAccess(guestId: string, eri: string) {
    const booking = await this.prisma.ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: eri },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const access = await this.prisma.booking_guest_access.findFirst({
      where: {
        ezee_reservation_id: eri,
        guest_id: guestId,
        status: 'APPROVED',
      },
    });
    if (!access) throw new BadRequestException('No access to this booking');

    return booking;
  }

  // ─── COLIVE: CREATE RAZORPAY ORDER ─────────────────────────────────────────

  /**
   * Creates a Razorpay order for a long-stay (colive) booking.
   * Operates on colive_draft_bookings, NOT ezee_booking_cache.
   *
   * POST /payment/create-colive-order
   */
  async createColiveOrder(
    guest: GuestJwtPayload,
    draftBookingId: string,
    grandTotal: number,
    currency = 'INR',
  ) {
    if (grandTotal <= 0) {
      throw new BadRequestException('Grand total must be greater than zero');
    }

    const draft = await this.prisma.colive_draft_bookings.findUnique({
      where: { id: draftBookingId },
      include: { properties: true },
    });

    if (!draft) throw new NotFoundException('Colive draft booking not found');
    if (draft.guest_id && draft.guest_id !== guest.guest_id) {
      throw new BadRequestException('This draft booking does not belong to you');
    }
    if (draft.status === 'confirmed') {
      throw new BadRequestException('This booking is already confirmed');
    }

    // Create Razorpay order
    const rzpOrder = await (this.razorpay.orders.create({
      amount: Math.round(grandTotal * 100),
      currency: currency ?? 'INR',
      receipt: draft.booking_reference,
      notes: {
        type: 'colive',
        draft_booking_id: draftBookingId,
        booking_reference: draft.booking_reference,
        guest_id: guest.guest_id,
      },
    }) as any as Promise<{ id: string }>);

    // Move draft to pending_payment
    await this.prisma.colive_draft_bookings.update({
      where: { id: draftBookingId },
      data: {
        status: 'pending_payment',
        razorpay_order_id: rzpOrder.id,
        guest_id: guest.guest_id,
        updated_at: new Date(),
      },
    });

    await this.sqsProducer.sendAuditLog({
      actor_type: 'GUEST',
      actor_id: guest.guest_id,
      action: 'COLIVE_PAYMENT_CREATED',
      entity_type: 'colive_draft_booking',
      entity_id: draftBookingId,
      new_value: {
        razorpay_order_id: rzpOrder.id,
        amount: grandTotal,
        booking_reference: draft.booking_reference,
      },
    });

    return {
      payment_order_id: rzpOrder.id,
      razorpay_order_id: rzpOrder.id,
      razorpay_key: process.env.RAZORPAY_TEST_API_KEY,
      amount: grandTotal,
      amount_paise: Math.round(grandTotal * 100),
      currency: currency ?? 'INR',
      draft_booking_id: draftBookingId,
      booking_reference: draft.booking_reference,
      guest: {
        name: `${draft.first_name} ${draft.last_name}`,
        email: draft.email,
        phone: draft.phone,
      },
    };
  }

  // ─── COLIVE: VERIFY PAYMENT ─────────────────────────────────────────────────

  /**
   * Verifies the Razorpay signature for a colive payment, confirms the draft
   * booking, and fires the eZee SQS sync message.
   *
   * POST /payment/verify-colive
   */
  async verifyColivePayment(
    guest: GuestJwtPayload,
    draftBookingId: string,
    razorpay_order_id: string,
    razorpay_payment_id: string,
    razorpay_signature: string,
  ) {
    // Verify Razorpay signature
    const expectedSig = createHmac('sha256', process.env.RAZORPAY_TEST_API_SECRET!)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      this.logger.warn(`Invalid colive payment signature for order ${razorpay_order_id}`);
      throw new BadRequestException('Invalid payment signature');
    }

    const draft = await this.prisma.colive_draft_bookings.findUnique({
      where: { id: draftBookingId },
      include: { properties: true },
    });

    if (!draft) throw new NotFoundException('Colive draft booking not found');
    if (draft.razorpay_order_id !== razorpay_order_id) {
      throw new BadRequestException('Razorpay order ID mismatch');
    }
    if (draft.status === 'confirmed') {
      return {
        message: 'Payment already captured',
        booking_id: draft.id,
        booking_reference: draft.booking_reference,
        status: 'confirmed',
        payment_id: draft.payment_id ?? '',
        total_paid: Number(draft.grand_total),
        currency: 'INR',
      };
    }

    // Look up the room type for eZee IDs
    const roomType = await this.prisma.room_types.findUnique({
      where: { id: draft.room_type_id },
    });

    // Look up the quote for eZee rate_per_night
    const quote = await this.prisma.colive_quotes.findUnique({
      where: { id: draft.quote_id },
    });

    const ratePerNight = quote?.ezee_rate_per_night
      ? Number(quote.ezee_rate_per_night)
      : Number(roomType?.base_price_per_night ?? 0);

    const moveIn = new Date(draft.move_in_date);
    const moveOut = draft.estimated_checkout ?? this.addColiveMonths(moveIn, draft.duration_months);
    const totalNights = Math.max(1, Math.ceil(
      (moveOut.getTime() - moveIn.getTime()) / (1000 * 60 * 60 * 24),
    ));

    // Confirm the draft booking
    const paymentRecordId = uuidv4();
    await this.prisma.colive_draft_bookings.update({
      where: { id: draftBookingId },
      data: {
        status: 'confirmed',
        payment_id: paymentRecordId,
        ezee_sync_status: 'PENDING',
        updated_at: new Date(),
        onboarding_json: {
          whatsapp_url: 'https://wa.me/919999999999',
          events_url: 'https://vibehouse.in/events',
          community_name: 'The Daily Social Community',
          next_steps: [
            'Complete your KYC before move-in',
            'Join The Daily Social WhatsApp community',
            'Download The Daily Social app for room access and services',
          ],
        },
      },
    });

    // SQS: queue eZee booking sync for this colive stay
    await this.sqsProducer.sendEzeeInsertColiveBooking({
      draft_booking_id: draftBookingId,
      property_id: draft.property_id,
      room_type_id: draft.room_type_id,
      guest_first_name: draft.first_name,
      guest_last_name: draft.last_name,
      guest_email: draft.email,
      guest_phone: draft.phone,
      move_in_date: this.formatColiveDate(moveIn),
      move_out_date: this.formatColiveDate(moveOut),
      rate_per_night: ratePerNight,
      total_nights: totalNights,
      amount: Number(draft.grand_total),
    });

    // SQS: audit log
    await this.sqsProducer.sendAuditLog({
      actor_type: 'GUEST',
      actor_id: guest.guest_id,
      action: 'COLIVE_BOOKING_CONFIRMED',
      entity_type: 'colive_draft_booking',
      entity_id: draftBookingId,
      new_value: {
        booking_reference: draft.booking_reference,
        razorpay_order_id,
        razorpay_payment_id,
        amount: Number(draft.grand_total),
      },
    });

    return {
      message: 'Colive booking confirmed',
      booking_id: draftBookingId,
      booking_reference: draft.booking_reference,
      status: 'confirmed',
      payment_id: paymentRecordId,
      total_paid: Number(draft.grand_total),
      currency: 'INR',
    };
  }

  private addColiveMonths(date: Date, months: number): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  }

  private formatColiveDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}

