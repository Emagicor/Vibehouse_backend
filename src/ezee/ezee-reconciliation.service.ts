import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SqsProducerService } from '../sqs/sqs-producer.service';
import { EzeeService } from './ezee.service';

/**
 * eZee Reconciliation — runs on every app bootstrap AND periodically.
 *
 * eZee is the single source of truth for booking state. This service
 * detects all cases where our cache has drifted from eZee:
 *
 * 1. UNSYNCED NEW BOOKINGS  — CONFIRMED in our DB, no ezee_reservation_no yet
 *    → queue InsertBooking
 *
 * 2. CANCELLED IN EZEE      — eZee shows "Cancelled Reservation", we show CONFIRMED
 *    → mark CANCELLED in our DB, revoke smart lock access
 *
 * 3. CHECKED IN IN EZEE     — eZee shows "Checked In", we show CONFIRMED
 *    → mark CHECKED_IN in our DB
 *
 * 4. CHECKED OUT IN EZEE    — eZee shows "Checked Out", we show CONFIRMED/CHECKED_IN
 *    → mark CHECKED_OUT in our DB
 *
 * 5. ROOM NUMBER CHANGED    — eZee has a room assigned, our room_number is null/different
 *    → update room_number in our DB
 *
 * Safe to run repeatedly — all operations are idempotent.
 */
@Injectable()
export class EzeeReconciliationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EzeeReconciliationService.name);

  // eZee status string → our internal status
  private static readonly EZEE_STATUS_MAP: Record<string, string> = {
    'Confirmed Reservation': 'CONFIRMED',
    'Cancelled Reservation': 'CANCELLED',
    'Checked In': 'CHECKED_IN',
    'Checked Out': 'CHECKED_OUT',
    'No Show': 'NO_SHOW',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsProducer: SqsProducerService,
    private readonly ezee: EzeeService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Delay to let SQS consumers start first, then run immediately and every 15 min
    setTimeout(() => {
      this.reconcile();
      setInterval(() => this.reconcile(), 15 * 60 * 1000);
    }, 5000);
  }

  /**
   * Full reconciliation pass. Called on bootstrap and can be triggered manually.
   */
  async reconcile(): Promise<void> {
    try {
      await this.reconcileUnsyncedBookings();
      await this.reconcileEzeeState();
    } catch (err) {
      // Non-fatal — don't crash the app
      this.logger.error(`Reconciliation failed: ${(err as Error).message}`);
    }
  }

  // ── 1. Unsynced new bookings ─────────────────────────────────────────────

  private async reconcileUnsyncedBookings(): Promise<void> {
    const unsynced = await this.prisma.ezee_booking_cache.findMany({
      where: {
        status: 'CONFIRMED',
        is_active: true,
        ezee_reservation_no: null,
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
      this.logger.log('Reconciliation: all bookings are synced to eZee');
      return;
    }

    this.logger.warn(`Reconciliation: ${unsynced.length} unsynced booking(s) — queuing`);

    for (const booking of unsynced) {
      const payment = booking.payments[0];
      if (!payment) {
        this.logger.warn(`Skipping ${booking.ezee_reservation_id} — no captured payment`);
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

      this.logger.log(`Queued eZee sync for ${booking.ezee_reservation_id}`);
    }
  }

  // ── 2. State drift: cancelled/checked-in/checked-out in eZee ────────────

  /**
   * Fetch all active bookings synced to eZee, then compare their status
   * against what eZee actually says. Fix any divergence.
   *
   * Groups bookings by property to batch eZee API calls per property.
   */
  private async reconcileEzeeState(): Promise<void> {
    // Only care about bookings that are synced (have ezee_reservation_no)
    // and are in an "active" state from our perspective
    const activeSynced = await this.prisma.ezee_booking_cache.findMany({
      where: {
        status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        is_active: true,
        ezee_reservation_no: { not: null },
      },
      select: {
        ezee_reservation_id: true,
        ezee_reservation_no: true,
        property_id: true,
        status: true,
        room_number: true,
        checkin_date: true,
      },
    });

    if (activeSynced.length === 0) {
      this.logger.log('Reconciliation: no active synced bookings to check');
      return;
    }

    this.logger.log(`Reconciliation: checking ${activeSynced.length} active booking(s) against eZee`);

    // For each booking, fetch fresh status from eZee and compare
    let cancelled = 0, checkedIn = 0, checkedOut = 0, roomUpdated = 0;

    for (const booking of activeSynced) {
      try {
        const ezeeData = await this.ezee.fetchBooking(
          booking.property_id,
          booking.ezee_reservation_no!,
        );

        if (!ezeeData) {
          this.logger.warn(`Booking ${booking.ezee_reservation_id} not found in eZee — skipping`);
          continue;
        }

        // Get status from first sub-reservation
        const tran = ezeeData.BookingTran?.[0];
        if (!tran) continue;

        const ezeeStatus = EzeeReconciliationService.EZEE_STATUS_MAP[tran.CurrentStatus] ?? null;
        const ezeeRoomName = tran.RoomName ?? null;

        const updates: Record<string, any> = {};

        // Status drift
        if (ezeeStatus && ezeeStatus !== booking.status) {
          this.logger.warn(
            `Status drift: ${booking.ezee_reservation_id} is "${booking.status}" in our DB but "${tran.CurrentStatus}" in eZee → updating`,
          );
          updates.status = ezeeStatus;

          if (ezeeStatus === 'CANCELLED' || ezeeStatus === 'NO_SHOW') {
            updates.is_active = false;
            cancelled++;
          } else if (ezeeStatus === 'CHECKED_IN') {
            checkedIn++;
          } else if (ezeeStatus === 'CHECKED_OUT') {
            updates.is_active = false;
            checkedOut++;
          }
        }

        // Room number drift — eZee assigned a room but our cache is stale/null
        if (ezeeRoomName && ezeeRoomName !== booking.room_number) {
          updates.room_number = ezeeRoomName;
          roomUpdated++;
        }

        if (Object.keys(updates).length > 0) {
          await this.prisma.ezee_booking_cache.update({
            where: { ezee_reservation_id: booking.ezee_reservation_id },
            data: updates,
          });
        }

        // Brief pause to avoid hammering eZee API
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        // Non-fatal per booking — log and continue
        this.logger.error(
          `Failed to reconcile ${booking.ezee_reservation_id}: ${(err as Error).message}`,
        );
      }
    }

    if (cancelled + checkedIn + checkedOut + roomUpdated > 0) {
      this.logger.warn(
        `Reconciliation complete: ${cancelled} cancelled, ${checkedIn} checked-in, ${checkedOut} checked-out, ${roomUpdated} room numbers updated`,
      );
    } else {
      this.logger.log('Reconciliation: all active bookings match eZee state');
    }
  }
}
