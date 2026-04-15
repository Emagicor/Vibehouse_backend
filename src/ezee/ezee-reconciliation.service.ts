import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { SqsProducerService } from '../sqs/sqs-producer.service';
import { EzeeService } from './ezee.service';
import { EmailService } from '../email/email.service';

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
    'Dayuse Reservation': 'CONFIRMED', // day-use = no overnight stay, treat as confirmed
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsProducer: SqsProducerService,
    private readonly ezee: EzeeService,
    private readonly email: EmailService,
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
      await this.ingestExternalBookings();
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
        ezee_reservation_id: { startsWith: 'TDS-' },
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

  // ── 3. Ingest external bookings (OTAs, walk-ins, staff-made) ────────────

  /**
   * Pulls all eZee reservations arriving yesterday → 30 days from now,
   * and creates ezee_booking_cache entries for any we don't already have.
   *
   * This covers bookings made via OTAs (MakeMyTrip, Agoda, Booking.com),
   * walk-ins entered directly in eZee, or staff-created reservations.
   *
   * ERIs are generated as `EZEE-{CITY_CODE}-{reservationNo}`.
   */
  private async ingestExternalBookings(): Promise<void> {
    const properties = await this.prisma.properties.findMany({
      select: { id: true, city: true, name: true },
    });

    let ingested = 0;

    for (const property of properties) {
      try {
        // Fetch eZee reservations: yesterday to 28 days out (eZee max window = 30 days)
        const fromDate = this.offsetDate(-1);
        const toDate = this.offsetDate(28);

        const ezeeReservations = await this.ezee.fetchReservationsByDateRange(
          property.id,
          fromDate,
          toDate,
        );

        if (ezeeReservations.length === 0) continue;

        // Find which reservation numbers we already have cached
        const ezeeResNos = ezeeReservations.map((r) => r.reservationNo);
        const existing = await this.prisma.ezee_booking_cache.findMany({
          where: { ezee_reservation_no: { in: ezeeResNos } },
          select: { ezee_reservation_no: true },
        });
        const existingSet = new Set(existing.map((e) => e.ezee_reservation_no));

        // Also check by generated ERI in case it was already ingested
        const cityCode = (property.city || 'UNK').substring(0, 3).toUpperCase();
        const generatedEris = ezeeResNos.map((no) => `EZEE-${cityCode}-${no}`);
        const existingByEri = await this.prisma.ezee_booking_cache.findMany({
          where: { ezee_reservation_id: { in: generatedEris } },
          select: { ezee_reservation_id: true },
        });
        const existingEriSet = new Set(existingByEri.map((e) => e.ezee_reservation_id));

        for (const res of ezeeReservations) {
          // Skip if already cached (by eZee reservation_no or by generated ERI)
          if (existingSet.has(res.reservationNo)) continue;
          const eri = `EZEE-${cityCode}-${res.reservationNo}`;
          if (existingEriSet.has(eri)) continue;

          // Skip cancelled/no-show — no point caching dead bookings
          const mappedStatus = EzeeReconciliationService.EZEE_STATUS_MAP[res.status];
          if (mappedStatus === 'CANCELLED' || mappedStatus === 'NO_SHOW') continue;

          await this.prisma.ezee_booking_cache.create({
            data: {
              ezee_reservation_id: eri,
              property_id: property.id,
              ezee_reservation_no: res.reservationNo,
              room_type_name: res.roomTypeName,
              room_number: res.roomName,
              checkin_date: res.checkin ? new Date(res.checkin) : null,
              checkout_date: res.checkout ? new Date(res.checkout) : null,
              no_of_guests: res.noOfGuests,
              booker_email: res.email,
              booker_phone: res.phone,
              source: res.source ?? 'External',
              status: mappedStatus ?? 'CONFIRMED',
              is_active: true,
              fetched_at: new Date(),
            },
          });

          this.logger.log(
            `Ingested external booking: ${eri} (eZee#${res.reservationNo}, ${res.source ?? 'unknown'}, ${res.firstName} ${res.lastName})`,
          );
          ingested++;

          // Immediate guest match — link and email if a TDS account already exists
          const emailOrPhone = res.email || res.phone;
          if (emailOrPhone) {
            try {
              const matchConditions: any[] = [];
              if (res.email) matchConditions.push({ email: res.email });
              if (res.phone) matchConditions.push({ phone: res.phone });

              const match = await this.prisma.guests.findFirst({
                where: { OR: matchConditions },
                select: { id: true, name: true, email: true },
              });

              if (match) {
                await this.prisma.booking_guest_access.create({
                  data: {
                    id: uuidv4(),
                    ezee_reservation_id: eri,
                    guest_id: match.id,
                    role: 'PRIMARY',
                    status: 'APPROVED',
                    approved_by_guest_id: match.id,
                    approved_at: new Date(),
                  },
                });
                this.logger.log(`Immediately linked guest ${match.id} to ingested booking ${eri}`);

                if (match.email) {
                  this.email.sendOtaBookingLinkedEmail({
                    toEmail: match.email,
                    firstName: match.name?.split(' ')[0] ?? 'there',
                    bookingId: eri,
                    propertyName: property.name ?? 'The Daily Social',
                    roomTypeName: res.roomTypeName ?? 'your room',
                    checkinDate: res.checkin ?? '',
                    checkoutDate: res.checkout ?? '',
                    source: res.source ?? 'an OTA',
                  }).catch((e: Error) => this.logger.warn(`OTA link email failed for ${eri}: ${e.message}`));
                }
              }
            } catch (linkErr) {
              // Non-fatal — autoLinkBookings() will catch this on the guest's next auth event
              this.logger.warn(`Immediate guest match failed for ${eri}: ${(linkErr as Error).message}`);
            }
          }
        }

        // Brief pause between properties
        if (properties.length > 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (err) {
        this.logger.error(
          `Failed to ingest external bookings for ${property.id}: ${(err as Error).message}`,
        );
      }
    }

    if (ingested > 0) {
      this.logger.warn(`Reconciliation: ingested ${ingested} external booking(s) from eZee`);
    } else {
      this.logger.log('Reconciliation: no new external bookings to ingest');
    }
  }

  private offsetDate(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }
}
