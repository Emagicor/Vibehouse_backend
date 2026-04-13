import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { EzeeSyncMessageType } from '../sqs.constants';
import type { SqsWorker } from '../sqs-consumer.service';
import type {
  SqsMessageEnvelope,
  EzeeInsertBookingPayload,
  EzeeAddExtraChargePayload,
  EzeeUpdateReservationPayload,
  EzeeInsertColiveBookingPayload,
} from '../types/messages';
import { EzeeService } from '../../ezee/ezee.service';
import { EzeeApiError } from '../../ezee/ezee.types';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';

/**
 * eZee Sync Worker — consumes vibehouse-ezee-sync.fifo
 *
 * Processes eZee PMS API calls one at a time (maxMessages=1) to respect
 * eZee's rate limits. Each booking sync involves 5 sequential API calls
 * with 2.5s delays between them.
 */
@Injectable()
export class EzeeSyncWorker implements SqsWorker {
  private readonly logger = new Logger(EzeeSyncWorker.name);

  constructor(
    private readonly ezee: EzeeService,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async process(message: SqsMessageEnvelope): Promise<void> {
    switch (message.type) {
      case EzeeSyncMessageType.INSERT_BOOKING:
        await this.handleInsertBooking(message.payload as EzeeInsertBookingPayload);
        break;

      case EzeeSyncMessageType.INSERT_COLIVE_BOOKING:
        await this.handleInsertColiveBooking(message.payload as EzeeInsertColiveBookingPayload);
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

  // ── Helpers ──────────────────────────────────────────────────────────────

  private delay(ms = 2500): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async createSyncLog(entityType: string, entityId: string, action: string): Promise<string> {
    const id = uuidv4();
    await this.prisma.ezee_sync_log.create({
      data: {
        id,
        entity_type: entityType,
        entity_id: entityId,
        action,
        status: 'PENDING',
        attempts: 1,
        last_attempted_at: new Date(),
      },
    });
    return id;
  }

  private async updateSyncLog(id: string, status: string, error?: string): Promise<void> {
    await this.prisma.ezee_sync_log.update({
      where: { id },
      data: {
        status,
        error_message: error ?? null,
        last_attempted_at: new Date(),
      },
    });
  }

  // ── INSERT BOOKING ───────────────────────────────────────────────────────

  /**
   * Full booking sync flow:
   * 1. InsertBooking → get ReservationNo
   * 2. ProcessBooking → confirm (eZee auto-assigns room)
   * 3. FetchSingleBooking → capture auto-assigned room name/ID
   * 4. AddPayment → record in folio
   *
   * Idempotent: checks ezee_reservation_no to skip already-completed steps.
   */
  private async handleInsertBooking(payload: EzeeInsertBookingPayload): Promise<void> {
    const { eri, property_id } = payload;

    const booking = await this.prisma.ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: eri },
    });
    if (!booking) {
      this.logger.error(`Booking ${eri} not found — skipping`);
      return;
    }

    const guest = await this.prisma.guests.findUnique({
      where: { id: booking.guest_id! },
    });
    if (!guest) {
      this.logger.error(`Guest ${booking.guest_id} not found for booking ${eri} — skipping`);
      return;
    }

    const syncLogId = await this.createSyncLog('booking', eri, 'INSERT_BOOKING');

    try {
      // Parse room selections from booking_rooms_json (with DB fallback for older bookings)
      const roomSelections = await this.parseBookingRooms(booking);
      if (roomSelections.length === 0) {
        throw new Error(`No room selections found for booking ${eri}`);
      }

      // ── Step 1: InsertBooking (skip if already done) ──────────────────
      let reservationNo = booking.ezee_reservation_no ?? null;
      let subReservationNos: string[] = booking.ezee_sub_reservation_nos
        ? booking.ezee_sub_reservation_nos.split(',')
        : [];

      if (!reservationNo) {
        // Parse guest name
        const nameParts = (guest.name || 'Guest').trim().split(/\s+/);
        const firstName = nameParts[0];
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : firstName;

        // Build rooms for eZee
        const numberOfNights = this.calcNights(booking.checkin_date, booking.checkout_date);
        const ezeeRooms = this.buildEzeeRooms(roomSelections, numberOfNights, firstName, lastName);

        const checkin = this.formatDate(booking.checkin_date);
        const checkout = this.formatDate(booking.checkout_date);

        this.logger.log(`eZee InsertBooking: ERI=${eri}, ${ezeeRooms.length} room(s), ${checkin} → ${checkout}`);

        const result = await this.ezee.insertBooking(property_id, {
          checkin,
          checkout,
          email: guest.email ?? '',
          phone: guest.phone ?? '',
          rooms: ezeeRooms,
        });

        reservationNo = result.reservationNo;
        subReservationNos = result.subReservationNos;

        // Persist eZee reservation number
        await this.prisma.ezee_booking_cache.update({
          where: { ezee_reservation_id: eri },
          data: {
            ezee_reservation_no: reservationNo,
            ezee_sub_reservation_nos: subReservationNos.join(','),
          },
        });

        await this.delay();
      } else {
        this.logger.log(`eZee InsertBooking already done for ${eri}: ReservationNo=${reservationNo}`);
      }

      // ── Step 2: ProcessBooking (Confirm) ──────────────────────────────
      // eZee auto-assigns a room when the booking is confirmed.
      this.logger.log(`eZee ProcessBooking: confirming ${reservationNo}`);
      await this.ezee.processBooking(property_id, reservationNo);
      await this.delay();

      // ── Step 3: FetchSingleBooking → capture auto-assigned room ───────
      try {
        const reservationData = await this.ezee.fetchBooking(property_id, reservationNo);
        const tran = reservationData?.BookingTran?.[0];
        if (tran?.RoomName) {
          await this.prisma.ezee_booking_cache.update({
            where: { ezee_reservation_id: eri },
            data: {
              room_number: tran.RoomName,
              unit_code: tran.RoomID ?? null,
            },
          });
          this.logger.log(`eZee room auto-assigned: ${tran.RoomName} (${tran.RoomID}) for ${eri}`);
        }
      } catch (err) {
        // Non-fatal — room info can be looked up in eZee UI
        this.logger.warn(`eZee FetchSingleBooking failed for ${eri}: ${(err as Error).message}`);
      }
      await this.delay();

      // ── Step 4: AddPayment ────────────────────────────────────────────
      // Split payment evenly across all sub-reservations.
      // eZee creates one sub-reservation per bed (30-1, 30-2, ...) and
      // each needs its own payment entry in the folio.
      const paymentTargets = subReservationNos.length > 0 ? subReservationNos : [reservationNo];
      const amountPerBed = Math.floor(payload.amount / paymentTargets.length);

      for (let i = 0; i < paymentTargets.length; i++) {
        // Last sub-reservation gets any remainder from rounding
        const amount = i === paymentTargets.length - 1
          ? payload.amount - amountPerBed * i
          : amountPerBed;

        this.logger.log(`eZee AddPayment: ${paymentTargets[i]}, ₹${amount} (${i + 1}/${paymentTargets.length})`);
        try {
          await this.ezee.addPayment(property_id, paymentTargets[i], amount);
          if (i < paymentTargets.length - 1) await this.delay(1000); // brief pause between calls
        } catch (err) {
          // AddPayment failure is non-fatal — folio can be updated manually
          this.logger.warn(`eZee AddPayment failed for ${paymentTargets[i]}: ${(err as Error).message}`);
        }
      }

      // ── Done ──────────────────────────────────────────────────────────
      await this.updateSyncLog(syncLogId, 'SUCCESS');

      // Invalidate room availability cache for this property + date range
      const checkin = this.formatDate(booking.checkin_date);
      const checkout = this.formatDate(booking.checkout_date);
      const cacheKey = CacheService.roomAvailabilityKey(property_id, checkin, checkout);
      await this.cache.del(cacheKey);

      this.logger.log(`eZee booking sync complete: ERI=${eri}, eZee=${reservationNo}`);
    } catch (err) {
      const message = err instanceof EzeeApiError
        ? `[${err.code}] ${err.message}`
        : (err as Error).message;

      this.logger.error(`eZee InsertBooking failed for ${eri}: ${message}`);
      await this.updateSyncLog(syncLogId, 'FAILED', message);
      throw err; // Let SQS retry
    }
  }

  // ── ADD EXTRA CHARGE ─────────────────────────────────────────────────────

  private async handleAddExtraCharge(payload: EzeeAddExtraChargePayload): Promise<void> {
    const { eri, property_id, items } = payload;

    const booking = await this.prisma.ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: eri },
    });

    if (!booking) {
      this.logger.error(`Booking ${eri} not found for AddExtraCharge — skipping`);
      return;
    }

    // Need the eZee reservation number — if not synced yet, retry later
    const reservationNo = booking.ezee_reservation_no;
    if (!reservationNo) {
      this.logger.warn(`eZee reservation not yet synced for ${eri} — retrying`);
      throw new Error(`eZee reservation not synced yet for ${eri}`);
    }

    const subNos = booking.ezee_sub_reservation_nos?.split(',') ?? [];
    const bookingId = subNos[0] ?? reservationNo;

    const totalAmount = items.reduce((sum, item) => sum + item.amount * item.quantity, 0);

    const syncLogId = await this.createSyncLog('addon', eri, 'ADD_EXTRA_CHARGE');

    try {
      this.logger.log(`eZee AddPayment (addon): Booking ${bookingId}, ₹${totalAmount}, ${items.length} items`);
      await this.ezee.addPayment(property_id, bookingId, totalAmount);
      await this.updateSyncLog(syncLogId, 'SUCCESS');
      this.logger.log(`eZee addon charge synced for ${eri}`);
    } catch (err) {
      const message = err instanceof EzeeApiError
        ? `[${err.code}] ${err.message}`
        : (err as Error).message;

      this.logger.error(`eZee AddExtraCharge failed for ${eri}: ${message}`);
      await this.updateSyncLog(syncLogId, 'FAILED', message);
      throw err; // Let SQS retry
    }
  }

  // ── UPDATE RESERVATION ───────────────────────────────────────────────────

  private async handleUpdateReservation(payload: EzeeUpdateReservationPayload): Promise<void> {
    this.logger.log(`[STUB] eZee UpdateReservation: ERI ${payload.eri}`);
    // Phase 2: stay extensions, cancellations, date changes
  }

  // ── INSERT COLIVE BOOKING ─────────────────────────────────────────────────

  /**
   * Syncs a confirmed colive (long-stay) booking to eZee PMS.
   * Same pipeline as nightly bookings:
   *   InsertBooking → ProcessBooking → (FetchSingleBooking) → AddPayment
   *
   * On success: updates colive_draft_bookings.ezee_reservation_no + ezee_sync_status
   */
  private async handleInsertColiveBooking(payload: EzeeInsertColiveBookingPayload): Promise<void> {
    const {
      draft_booking_id, property_id, room_type_id,
      guest_first_name, guest_last_name, guest_email, guest_phone,
      move_in_date, move_out_date, rate_per_night, total_nights, amount,
    } = payload;

    const draft = await this.prisma.colive_draft_bookings.findUnique({
      where: { id: draft_booking_id },
    });
    if (!draft) {
      this.logger.error(`Colive draft booking ${draft_booking_id} not found — skipping`);
      return;
    }

    // Idempotency check — skip if already synced
    if (draft.ezee_reservation_no) {
      this.logger.log(`Colive booking ${draft_booking_id} already synced (${draft.ezee_reservation_no})`);
      return;
    }

    // Fetch room type for eZee IDs
    const roomType = await this.prisma.room_types.findUnique({ where: { id: room_type_id } });
    if (!roomType?.ezee_room_type_id) {
      // Throw so SQS retries — do NOT silently return or the booking is lost
      throw new Error(
        `Room type ${room_type_id} has no ezee_room_type_id configured. ` +
        `Run scripts/detect-ezee-room-types.ts and set the ID, then the retry will succeed.`,
      );
    }

    const syncLogId = await this.createSyncLog('colive_draft_booking', draft_booking_id, 'INSERT_COLIVE_BOOKING');

    try {
      // ── Step 1: InsertBooking ─────────────────────────────────────────────
      const title = 'Mr';
      const rateStr = Array(total_nights).fill(String(Math.round(rate_per_night))).join(',');
      const zeroStr = Array(total_nights).fill('0').join(',');

      this.logger.log(`eZee InsertBooking (colive): ${draft_booking_id}, ${total_nights} nights, ${move_in_date} → ${move_out_date}`);

      const result = await this.ezee.insertBooking(property_id, {
        checkin: move_in_date,
        checkout: move_out_date,
        email: guest_email,
        phone: guest_phone,
        rooms: [{
          ezeeRoomTypeId: roomType.ezee_room_type_id,
          ezeeRatePlanId: roomType.ezee_rate_plan_id ?? '',
          ezeeRateTypeId: roomType.ezee_rate_type_id ?? roomType.ezee_rate_plan_id ?? '',
          adults: 1,
          children: 0,
          ratePerNight: rate_per_night,
          numberOfNights: total_nights,
          guestTitle: title,
          guestFirstName: guest_first_name,
          guestLastName: guest_last_name,
          guestGender: 'Male',
        }],
      });

      const reservationNo = result.reservationNo;
      const subReservationNos = result.subReservationNos;

      // Persist eZee reservation number to draft
      await this.prisma.colive_draft_bookings.update({
        where: { id: draft_booking_id },
        data: {
          ezee_reservation_no: reservationNo,
          ezee_sync_status: 'PARTIAL',
          updated_at: new Date(),
        },
      });
      await this.delay();

      // ── Step 2: ProcessBooking ────────────────────────────────────────────
      this.logger.log(`eZee ProcessBooking (colive): confirming ${reservationNo}`);
      await this.ezee.processBooking(property_id, reservationNo);
      await this.delay();

      // ── Step 3: AddPayment ────────────────────────────────────────────────
      const paymentTargets = subReservationNos.length > 0 ? subReservationNos : [reservationNo];
      const amountPerBed = Math.floor(amount / paymentTargets.length);

      for (let i = 0; i < paymentTargets.length; i++) {
        const bedAmount = i === paymentTargets.length - 1
          ? amount - amountPerBed * i
          : amountPerBed;

        this.logger.log(`eZee AddPayment (colive): ${paymentTargets[i]}, ₹${bedAmount}`);
        try {
          await this.ezee.addPayment(property_id, paymentTargets[i], bedAmount);
          if (i < paymentTargets.length - 1) await this.delay(1000);
        } catch (err) {
          this.logger.warn(`eZee AddPayment (colive) failed for ${paymentTargets[i]}: ${(err as Error).message}`);
        }
      }

      // ── Done ──────────────────────────────────────────────────────────────
      await this.prisma.colive_draft_bookings.update({
        where: { id: draft_booking_id },
        data: { ezee_sync_status: 'SYNCED', updated_at: new Date() },
      });

      await this.updateSyncLog(syncLogId, 'SUCCESS');
      this.logger.log(`eZee colive sync complete: draftId=${draft_booking_id}, eZee=${reservationNo}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`eZee colive sync failed for ${draft_booking_id}: ${message}`);
      await this.updateSyncLog(syncLogId, 'FAILED', message);
      await this.prisma.colive_draft_bookings.update({
        where: { id: draft_booking_id },
        data: { ezee_sync_status: 'FAILED', updated_at: new Date() },
      });
      throw err; // Let SQS retry
    }
  }

  // ── Room picking helpers ─────────────────────────────────────────────────

  private async parseBookingRooms(booking: any): Promise<Array<{
    ezeeRoomTypeId: string;
    ezeeRatePlanId: string;
    ezeeRateTypeId: string;
    quantity: number;
    pricePerNight: number;
    guests?: Array<{ first_name: string; last_name: string; gender?: string }>;
  }>> {
    if (booking.booking_rooms_json) {
      const rooms = typeof booking.booking_rooms_json === 'string'
        ? JSON.parse(booking.booking_rooms_json)
        : booking.booking_rooms_json;
      return rooms.map((r: any) => ({
        ezeeRoomTypeId: r.ezee_room_type_id,
        ezeeRatePlanId: r.ezee_rate_plan_id,
        ezeeRateTypeId: r.ezee_rate_type_id ?? r.ezee_rate_plan_id,
        quantity: r.quantity,
        pricePerNight: r.price_per_night,
        guests: r.guests ?? null,
      }));
    }

    // Fallback for older bookings without booking_rooms_json:
    // parse room_type_name string ("6 Bed Mixed Dormitory x1, Queen Size Room x1")
    // and look up eZee IDs from the room_types table.
    this.logger.warn(`No booking_rooms_json for ${booking.ezee_reservation_id} — falling back to room_type_name parsing`);

    if (!booking.room_type_name) return [];

    const dbRoomTypes = await this.prisma.room_types.findMany({
      where: { property_id: booking.property_id, is_active: true },
    });

    const selections: Array<{
      ezeeRoomTypeId: string;
      ezeeRatePlanId: string;
      ezeeRateTypeId: string;
      quantity: number;
      pricePerNight: number;
    }> = [];

    for (const segment of (booking.room_type_name as string).split(',')) {
      const match = segment.trim().match(/^(.+?)\s+x(\d+)$/i);
      if (!match) continue;
      const [, name, qtyStr] = match;
      const rt = dbRoomTypes.find(
        (r) => r.name.toLowerCase() === name.toLowerCase().trim(),
      );
      if (!rt) {
        this.logger.warn(`Room type "${name}" not found in DB for fallback parsing`);
        continue;
      }
      selections.push({
        ezeeRoomTypeId: rt.ezee_room_type_id ?? '',
        ezeeRatePlanId: rt.ezee_rate_plan_id ?? '',
        ezeeRateTypeId: rt.ezee_rate_type_id ?? rt.ezee_rate_plan_id ?? '',
        quantity: parseInt(qtyStr, 10),
        pricePerNight: Number(rt.base_price_per_night),
      });
    }

    return selections;
  }

  private buildEzeeRooms(
    roomSelections: Array<{
      ezeeRoomTypeId: string;
      ezeeRatePlanId: string;
      ezeeRateTypeId: string;
      quantity: number;
      pricePerNight: number;
      guests?: Array<{ first_name: string; last_name: string; gender?: string }>;
    }>,
    numberOfNights: number,
    defaultFirstName: string,
    defaultLastName: string,
  ) {
    const rooms: any[] = [];
    for (const sel of roomSelections) {
      for (let q = 0; q < sel.quantity; q++) {
        // Use per-guest details if provided, otherwise fall back to booker name
        const guestDetail = sel.guests?.[q];
        const firstName = guestDetail?.first_name ?? defaultFirstName;
        const lastName = guestDetail?.last_name ?? defaultLastName;
        const gender = guestDetail?.gender ?? 'Male';
        const title = gender === 'Female' ? 'Ms' : 'Mr';

        rooms.push({
          ezeeRoomTypeId: sel.ezeeRoomTypeId,
          ezeeRatePlanId: sel.ezeeRatePlanId,
          ezeeRateTypeId: sel.ezeeRateTypeId,
          adults: 1,
          children: 0,
          ratePerNight: sel.pricePerNight,
          numberOfNights,
          guestTitle: title,
          guestFirstName: firstName,
          guestLastName: lastName,
          guestGender: gender,
        });
      }
    }
    return rooms;
  }

  private calcNights(checkin: Date | null | undefined, checkout: Date | null | undefined): number {
    if (!checkin || !checkout) return 1;
    const ms = new Date(checkout).getTime() - new Date(checkin).getTime();
    return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }

  private formatDate(date: Date | null | undefined): string {
    if (!date) return '';
    const d = new Date(date);
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
  }
}
