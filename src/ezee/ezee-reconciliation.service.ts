import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SqsProducerService } from '../sqs/sqs-producer.service';

/**
 * eZee Reconciliation — runs on every app bootstrap (deploy/restart).
 *
 * Finds CONFIRMED bookings that were never synced to eZee
 * (ezee_reservation_no is null) and queues them for sync.
 *
 * Safe to run repeatedly — the EzeeSyncWorker is idempotent
 * (checks ezee_reservation_no before calling InsertBooking).
 */
@Injectable()
export class EzeeReconciliationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EzeeReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsProducer: SqsProducerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Small delay to let SQS consumers start first
    setTimeout(() => this.reconcileUnsyncedBookings(), 5000);
  }

  async reconcileUnsyncedBookings(): Promise<void> {
    try {
      // Find confirmed bookings that never got synced to eZee
      const unsynced = await this.prisma.ezee_booking_cache.findMany({
        where: {
          status: 'CONFIRMED',
          is_active: true,
          ezee_reservation_no: null,
          // Only VibeHouse-created bookings (not seed data or external imports)
          ezee_reservation_id: { startsWith: 'VH-' },
        },
        include: {
          payments: {
            where: { status: 'CAPTURED', purpose: 'booking' },
            orderBy: { created_at: 'desc' },
            take: 1,
          },
        },
      });

      if (unsynced.length === 0) {
        this.logger.log('eZee reconciliation: all bookings are synced');
        return;
      }

      this.logger.warn(`eZee reconciliation: found ${unsynced.length} unsynced booking(s) — queuing for sync`);

      for (const booking of unsynced) {
        const payment = booking.payments[0];
        if (!payment) {
          this.logger.warn(`Skipping ${booking.ezee_reservation_id} — no captured payment found`);
          continue;
        }

        await this.sqsProducer.sendEzeeInsertBooking({
          eri: booking.ezee_reservation_id,
          guest_id: booking.guest_id!,
          property_id: booking.property_id,
          room_type: booking.room_type_name,
          checkin: booking.checkin_date?.toISOString().split('T')[0] ?? null,
          checkout: booking.checkout_date?.toISOString().split('T')[0] ?? null,
          amount: Number(payment.amount),
        });

        this.logger.log(`Queued eZee sync for ${booking.ezee_reservation_id} (₹${payment.amount})`);
      }

      this.logger.log(`eZee reconciliation complete: ${unsynced.length} booking(s) queued`);
    } catch (err) {
      // Non-fatal — don't crash the app if reconciliation fails
      this.logger.error(`eZee reconciliation failed: ${(err as Error).message}`);
    }
  }
}
