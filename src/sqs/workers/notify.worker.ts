import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { NotifyMessageType, OpsMessageType } from '../sqs.constants';
import type { SqsWorker } from '../sqs-consumer.service';
import type {
  SqsMessageEnvelope,
  NotifyGuestPayload,
  NotifyStaffPayload,
  LowStockAlertPayload,
} from '../types/messages';

/**
 * Notification Worker — consumes vibehouse-notify
 *
 * Handles all outbound messaging. Currently writes to notification_log.
 * Actual delivery via Wati (WhatsApp) / Email will be added in Phase 2.
 */
@Injectable()
export class NotifyWorker implements SqsWorker {
  private readonly logger = new Logger(NotifyWorker.name);

  constructor(private readonly prisma: PrismaService) {}

  async process(message: SqsMessageEnvelope): Promise<void> {
    switch (message.type) {
      case NotifyMessageType.NOTIFY_GUEST:
        await this.handleNotifyGuest(message.payload as NotifyGuestPayload);
        break;

      case NotifyMessageType.NOTIFY_STAFF:
        await this.handleNotifyStaff(message.payload as NotifyStaffPayload);
        break;

      case OpsMessageType.LOW_STOCK_ALERT:
        await this.handleLowStockAlert(message.payload as LowStockAlertPayload);
        break;

      default:
        this.logger.warn(`Unknown notify message type: ${message.type}`);
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private async handleNotifyGuest(payload: NotifyGuestPayload): Promise<void> {
    this.logger.log(
      `[STUB] Notify guest ${payload.guest_id}: template=${payload.template}`,
    );

    // Write to notification_log (real record even if delivery is stubbed)
    await this.prisma.notification_log.create({
      data: {
        id: uuidv4(),
        recipient_guest_id: payload.guest_id,
        channel: 'WHATSAPP',
        type: payload.template,
        payload: payload.variables as object,
        status: 'QUEUED',
        sent_at: new Date(),
      },
    });

    // Future: Call Wati API to send WhatsApp
    // Future: Update status to 'SENT' or 'FAILED'
  }

  private async handleNotifyStaff(payload: NotifyStaffPayload): Promise<void> {
    this.logger.log(
      `[STUB] Notify staff ${payload.staff_name}: template=${payload.template}`,
    );

    // Write to notification_log
    await this.prisma.notification_log.create({
      data: {
        id: uuidv4(),
        recipient_zoho_staff_id: payload.staff_phone,
        channel: 'WHATSAPP',
        type: payload.template,
        payload: payload.variables as object,
        status: 'QUEUED',
        sent_at: new Date(),
      },
    });

    // Future: Call Wati API to send WhatsApp
  }

  private async handleLowStockAlert(payload: LowStockAlertPayload): Promise<void> {
    this.logger.warn(
      `⚠️ LOW STOCK: "${payload.product_name}" (${payload.available_stock} remaining, threshold: ${payload.threshold}) — property: ${payload.property_id}`,
    );

    // Future: Notify admin via WhatsApp / dashboard alert
  }
}
