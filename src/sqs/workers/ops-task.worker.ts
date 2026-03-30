import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { OpsMessageType } from '../sqs.constants';
import type { SqsWorker } from '../sqs-consumer.service';
import type {
  SqsMessageEnvelope,
  AuditLogPayload,
  PaymentSuccessPayload,
  BookingConfirmedPayload,
  TicketCreatedPayload,
} from '../types/messages';

/**
 * Ops Task Worker — consumes vibehouse-ops.fifo
 *
 * Handles internal side-effects that were previously inline in the request path:
 *   - audit_log       → writes to admin_activity_log
 *   - payment_success → logs + (future) triggers eZee sync
 *   - booking_confirmed → logs + (future) triggers eZee InsertBooking
 *   - ticket_created  → (future) creates Zoho Desk ticket
 */
@Injectable()
export class OpsTaskWorker implements SqsWorker {
  private readonly logger = new Logger(OpsTaskWorker.name);

  constructor(private readonly prisma: PrismaService) {}

  async process(message: SqsMessageEnvelope): Promise<void> {
    switch (message.type) {
      case OpsMessageType.AUDIT_LOG:
        await this.handleAuditLog(message.payload as AuditLogPayload);
        break;

      case OpsMessageType.PAYMENT_SUCCESS:
        await this.handlePaymentSuccess(message.payload as PaymentSuccessPayload);
        break;

      case OpsMessageType.BOOKING_CONFIRMED:
        await this.handleBookingConfirmed(message.payload as BookingConfirmedPayload);
        break;

      case OpsMessageType.TICKET_CREATED:
        await this.handleTicketCreated(message.payload as TicketCreatedPayload);
        break;

      default:
        this.logger.warn(`Unknown ops message type: ${message.type}`);
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private async handleAuditLog(payload: AuditLogPayload): Promise<void> {
    await this.prisma.admin_activity_log.create({
      data: {
        id: uuidv4(),
        actor_type: payload.actor_type,
        actor_id: payload.actor_id,
        action: payload.action,
        entity_type: payload.entity_type,
        entity_id: payload.entity_id,
        old_value: (payload.old_value ?? undefined) as any,
        new_value: (payload.new_value ?? undefined) as any,
        ip_address: payload.ip_address ?? null,
      },
    });
    this.logger.debug(`Audit log: ${payload.action} on ${payload.entity_type}/${payload.entity_id}`);
  }

  private async handlePaymentSuccess(payload: PaymentSuccessPayload): Promise<void> {
    this.logger.log(
      `Payment success: ${payload.payment_id} | ₹${payload.amount} | ERI: ${payload.eri}`,
    );

    // Future: Emit to eZee sync queue for AddExtraCharge
    // await this.sqsProducer.sendEzeeAddExtraCharge({ ... });

    // Future: Emit guest notification
    // await this.sqsProducer.sendNotifyGuest({ ... });
  }

  private async handleBookingConfirmed(payload: BookingConfirmedPayload): Promise<void> {
    this.logger.log(
      `Booking confirmed: ERI ${payload.eri} | Room: ${payload.room_type} | ${payload.checkin} → ${payload.checkout}`,
    );

    // Future: Emit to eZee sync queue for InsertBooking
    // await this.sqsProducer.sendEzeeInsertBooking({ ... });

    // Future: Emit guest notification (booking confirmation WhatsApp)
    // await this.sqsProducer.sendNotifyGuest({ ... });
  }

  private async handleTicketCreated(payload: TicketCreatedPayload): Promise<void> {
    this.logger.log(
      `Ticket created: ${payload.service_name} | ${payload.request_type} | Room: ${payload.room_number}`,
    );

    // Future: POST to Zoho Desk API, assign staff, set Redis SLA timers
    // Future: Emit staff notification
  }
}
