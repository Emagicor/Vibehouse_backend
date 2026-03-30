import { Injectable, Logger } from '@nestjs/common';
import {
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import {
  SQS_QUEUE_URLS,
  OpsMessageType,
  EzeeSyncMessageType,
  NotifyMessageType,
  SlaMessageType,
} from './sqs.constants';
import type {
  AuditLogPayload,
  PaymentSuccessPayload,
  BookingConfirmedPayload,
  TicketCreatedPayload,
  LowStockAlertPayload,
  EzeeInsertBookingPayload,
  EzeeAddExtraChargePayload,
  NotifyGuestPayload,
  NotifyStaffPayload,
  SlaEscalatePayload,
  SqsMessageEnvelope,
} from './types/messages';

@Injectable()
export class SqsProducerService {
  private readonly logger = new Logger(SqsProducerService.name);
  private readonly sqs: SQSClient;

  constructor() {
    this.sqs = new SQSClient({
      region: process.env.AWS_REGION ?? 'ap-south-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
    });
  }

  // ── Generic send ──────────────────────────────────────────────────────────

  /**
   * Send a message to a FIFO queue.
   * @param queueUrlEnvKey - env var key containing the queue URL
   * @param type - message type discriminator
   * @param payload - typed payload
   * @param messageGroupId - FIFO ordering key (e.g. ERI, 'system')
   */
  private async sendFifo<T extends string>(
    queueUrlEnvKey: string,
    type: T,
    payload: unknown,
    messageGroupId: string,
  ): Promise<void> {
    const queueUrl = process.env[queueUrlEnvKey];
    if (!queueUrl) {
      this.logger.warn(`SQS queue URL not configured: ${queueUrlEnvKey} — message dropped`);
      return;
    }

    const envelope: SqsMessageEnvelope<T> = {
      type,
      payload,
      timestamp: Date.now(),
    };

    try {
      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(envelope),
          MessageGroupId: messageGroupId,
          MessageDeduplicationId: `${type}-${uuidv4()}`,
        }),
      );
      this.logger.log(`SQS sent [${type}] → ${queueUrlEnvKey} (group: ${messageGroupId})`);
    } catch (err) {
      this.logger.error(`SQS send failed [${type}]: ${(err as Error).message}`);
      // Don't throw — SQS failures should not break the request path
    }
  }

  /**
   * Send a message to a Standard queue (no FIFO ordering).
   */
  private async sendStandard<T extends string>(
    queueUrlEnvKey: string,
    type: T,
    payload: unknown,
  ): Promise<void> {
    const queueUrl = process.env[queueUrlEnvKey];
    if (!queueUrl) {
      this.logger.warn(`SQS queue URL not configured: ${queueUrlEnvKey} — message dropped`);
      return;
    }

    const envelope: SqsMessageEnvelope<T> = {
      type,
      payload,
      timestamp: Date.now(),
    };

    try {
      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(envelope),
        }),
      );
      this.logger.log(`SQS sent [${type}] → ${queueUrlEnvKey}`);
    } catch (err) {
      this.logger.error(`SQS send failed [${type}]: ${(err as Error).message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OPS QUEUE (vibehouse-ops.fifo) — Internal operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Send an audit log write to the ops queue.
   * Falls back to returning the payload if SQS is unavailable (caller can write inline).
   */
  async sendAuditLog(payload: AuditLogPayload): Promise<void> {
    await this.sendFifo(
      SQS_QUEUE_URLS.OPS,
      OpsMessageType.AUDIT_LOG,
      payload,
      'system',
    );
  }

  /**
   * Emit after payment is successfully captured (addon upsell).
   */
  async sendPaymentSuccess(payload: PaymentSuccessPayload): Promise<void> {
    await this.sendFifo(
      SQS_QUEUE_URLS.OPS,
      OpsMessageType.PAYMENT_SUCCESS,
      payload,
      payload.eri,
    );
  }

  /**
   * Emit after a booking payment is captured and booking is CONFIRMED.
   */
  async sendBookingConfirmed(payload: BookingConfirmedPayload): Promise<void> {
    await this.sendFifo(
      SQS_QUEUE_URLS.OPS,
      OpsMessageType.BOOKING_CONFIRMED,
      payload,
      payload.eri,
    );
  }

  /**
   * Emit when a service request or borrowable checkout needs a Zoho ticket.
   */
  async sendTicketCreated(payload: TicketCreatedPayload): Promise<void> {
    await this.sendFifo(
      SQS_QUEUE_URLS.OPS,
      OpsMessageType.TICKET_CREATED,
      payload,
      payload.eri,
    );
  }

  /**
   * Emit when inventory drops below its low_stock_threshold.
   */
  async sendLowStockAlert(payload: LowStockAlertPayload): Promise<void> {
    await this.sendStandard(
      SQS_QUEUE_URLS.NOTIFY,
      OpsMessageType.LOW_STOCK_ALERT,
      payload,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EZEE SYNC QUEUE (vibehouse-ezee-sync.fifo) — Rate-limited eZee API calls
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Queue an eZee InsertBooking API call (rate-limited, processed one at a time).
   */
  async sendEzeeInsertBooking(payload: EzeeInsertBookingPayload): Promise<void> {
    await this.sendFifo(
      SQS_QUEUE_URLS.EZEE_SYNC,
      EzeeSyncMessageType.INSERT_BOOKING,
      payload,
      payload.eri,
    );
  }

  /**
   * Queue an eZee AddExtraCharge API call.
   */
  async sendEzeeAddExtraCharge(payload: EzeeAddExtraChargePayload): Promise<void> {
    await this.sendFifo(
      SQS_QUEUE_URLS.EZEE_SYNC,
      EzeeSyncMessageType.ADD_EXTRA_CHARGE,
      payload,
      payload.eri,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFY QUEUE (vibehouse-notify) — Outbound notifications
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Send a guest-facing notification (WhatsApp / Email).
   */
  async sendNotifyGuest(payload: NotifyGuestPayload): Promise<void> {
    await this.sendStandard(
      SQS_QUEUE_URLS.NOTIFY,
      NotifyMessageType.NOTIFY_GUEST,
      payload,
    );
  }

  /**
   * Send a staff-facing notification (WhatsApp).
   */
  async sendNotifyStaff(payload: NotifyStaffPayload): Promise<void> {
    await this.sendStandard(
      SQS_QUEUE_URLS.NOTIFY,
      NotifyMessageType.NOTIFY_STAFF,
      payload,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SLA ESCALATION QUEUE (vibehouse-sla-escalate) — SLA timer events
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Emit an SLA escalation event (triggered by Redis keyspace notification).
   */
  async sendSlaEscalation(payload: SlaEscalatePayload): Promise<void> {
    await this.sendStandard(
      SQS_QUEUE_URLS.SLA_ESCALATE,
      SlaMessageType.SLA_ESCALATE,
      payload,
    );
  }
}
