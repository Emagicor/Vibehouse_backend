import { Injectable, Logger } from '@nestjs/common';
import { EzeeSyncMessageType } from '../sqs.constants';
import type { SqsWorker } from '../sqs-consumer.service';
import type {
  SqsMessageEnvelope,
  EzeeInsertBookingPayload,
  EzeeAddExtraChargePayload,
  EzeeUpdateReservationPayload,
} from '../types/messages';

/**
 * eZee Sync Worker — consumes vibehouse-ezee-sync.fifo
 *
 * Processes eZee PMS API calls one at a time (maxMessages=1) to respect
 * eZee's rate limits. All eZee API calls go through this single-threaded
 * consumer instead of being called inline from multiple concurrent requests.
 *
 * Currently STUBBED — eZee InsertBooking is blocked pending payment gateway
 * configuration in eZee admin panel. Handlers log the action and return.
 */
@Injectable()
export class EzeeSyncWorker implements SqsWorker {
  private readonly logger = new Logger(EzeeSyncWorker.name);

  async process(message: SqsMessageEnvelope): Promise<void> {
    switch (message.type) {
      case EzeeSyncMessageType.INSERT_BOOKING:
        await this.handleInsertBooking(message.payload as EzeeInsertBookingPayload);
        break;

      case EzeeSyncMessageType.ADD_EXTRA_CHARGE:
        await this.handleAddExtraCharge(message.payload as EzeeAddExtraChargePayload);
        break;

      case EzeeSyncMessageType.UPDATE_RESERVATION:
        await this.handleUpdateReservation(message.payload as EzeeUpdateReservationPayload);
        break;

      default:
        this.logger.warn(`Unknown eZee sync message type: ${message.type}`);
    }
  }

  // ── Handlers (all stubbed — eZee integration blocked) ─────────────────────

  private async handleInsertBooking(payload: EzeeInsertBookingPayload): Promise<void> {
    this.logger.log(
      `[STUB] eZee InsertBooking: ERI ${payload.eri} | Room: ${payload.room_type} | ₹${payload.amount}`,
    );
    // Future: Call eZee API with RES_Request wrapper
    // Future: Update ezee_sync_log with result
  }

  private async handleAddExtraCharge(payload: EzeeAddExtraChargePayload): Promise<void> {
    this.logger.log(
      `[STUB] eZee AddExtraCharge: ERI ${payload.eri} | ${payload.items.length} items`,
    );
    // Future: Call eZee AddExtraCharge API
    // Future: Update ezee_sync_log with result
  }

  private async handleUpdateReservation(payload: EzeeUpdateReservationPayload): Promise<void> {
    this.logger.log(
      `[STUB] eZee UpdateReservation: ERI ${payload.eri}`,
    );
    // Future: Call eZee API to update reservation details
  }
}
