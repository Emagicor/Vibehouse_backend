import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EzeeApiError,
  EzeeBookingInput,
  EzeeInsertBookingResult,
  EzeeReservationSummary,
  EzeeRoomAssignment,
  EzeeRoomAvailabilityResult,
  EzeeRoomInventoryResult,
  EzeePhysicalRoomCatalogResult,
} from './ezee.types';

/**
 * HTTP client for all eZee PMS API calls.
 *
 * Reads credentials from `ezee_connection` table per property.
 * All methods throw `EzeeApiError` on failure.
 */
@Injectable()
export class EzeeService {
  private readonly logger = new Logger(EzeeService.name);

  private static readonly KIOSK_PATH = '/index.php/page/service.kioskconnectivity';
  private static readonly RESERVATION_PATH = '/booking/reservation_api/listing.php';
  private static readonly PMS_PATH = '/pmsinterface/pms_connectivity.php';
  private static readonly VACATION_RENTAL_PATH = '/channelbookings/vacation_rental.php';

  // Known payment method & currency IDs (from eZee RetrievePayMethods)
  private static readonly PAYMENT_ID_CASH = '6076500000000000013';
  private static readonly CURRENCY_ID_INR = '6076500000000000001';

  constructor(private readonly prisma: PrismaService) {}

  // ── Credentials ──────────────────────────────────────────────────────────

  private async getConnection(propertyId: string) {
    const conn = await this.prisma.ezee_connection.findFirst({
      where: { property_id: propertyId, is_active: true },
    });
    if (!conn) {
      throw new EzeeApiError('NO_CONNECTION', `No active eZee connection for property ${propertyId}`, 'getConnection');
    }
    return {
      hotelCode: conn.hotel_code,
      authCode: conn.api_key,
      baseUrl: conn.api_endpoint.replace(/\/+$/, ''), // trim trailing slash
    };
  }

  // ── 1. Physical Room Catalog (all rooms, no date filter) ─────────────────

  /**
   * Fetches ALL room types from eZee unconditionally — regardless of
   * availability or date range. Uses the Vacation Rental API endpoint.
   *
   * room_id returned here equals roomtypeunkid used in RoomList / InsertBooking.
   * Use this to power the catalog layer; overlay getRoomInventory() for
   * live rates + availability counts on specific dates.
   */
  async getPhysicalRooms(propertyId: string): Promise<EzeePhysicalRoomCatalogResult> {
    const { hotelCode, authCode, baseUrl } = await this.getConnection(propertyId);

    const resp = await fetch(`${baseUrl}${EzeeService.VACATION_RENTAL_PATH}`, {
      method: 'POST',
      headers: {
        // AUTH_CODE goes as a separate header — the combined Content-Type format
        // returns error 104. Two headers is the correct working format.
        'Content-Type': 'application/json',
        'AUTH_CODE': authCode,
      },
      body: JSON.stringify({
        request_type: 'get_rooms',
        body: { hotel_id: hotelCode },
      }),
    });

    const data = await resp.json();

    if (data.status !== 'success') {
      throw new EzeeApiError(
        String(data.error_code ?? 'UNKNOWN'),
        data.error_message ?? JSON.stringify(data),
        'get_rooms',
      );
    }

    const rawRooms: any[] = data.data?.rooms ?? [];
    const rooms = rawRooms.map((r) => ({
      roomId: String(r.room_id),
      roomName: String(r.room_name),
      // "rooms" field is a CSV of physical room numbers: "106,107,108"
      physicalRoomNos: r.rooms ? String(r.rooms).split(',').map((s: string) => s.trim()) : [],
      // "room_code" field is CSV of "number : status" pairs
      physicalRoomCodes: r.room_code ? String(r.room_code).split(',').map((s: string) => s.trim()) : [],
    }));

    this.logger.debug(`eZee get_rooms: ${rooms.map((r) => `${r.roomName}(${r.roomId})`).join(', ')}`);
    return { rooms };
  }

  // ── 2. Room Availability (kiosk) ─────────────────────────────────────────

  async getRoomAvailability(
    propertyId: string,
    checkin: string,
    checkout: string,
  ): Promise<EzeeRoomAvailabilityResult> {
    const { hotelCode, authCode, baseUrl } = await this.getConnection(propertyId);

    const body = {
      RES_Request: {
        Request_Type: 'RoomAvailability',
        Authentication: { HotelCode: hotelCode, AuthCode: authCode },
        RoomData: { from_date: checkin, to_date: checkout },
      },
    };

    const resp = await fetch(`${baseUrl}${EzeeService.KIOSK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    this.checkKioskError(data, 'RoomAvailability');

    const roomList = data.Success?.RoomList ?? [];
    return {
      rooms: roomList.map((rt: any) => ({
        roomTypeId: rt.RoomtypeID,
        roomTypeName: rt.RoomtypeName,
        physicalRooms: (rt.RoomData ?? []).map((r: any) => ({
          roomId: r.RoomID,
          roomName: r.RoomName,
        })),
      })),
    };
  }

  // ── 1b. Room Inventory (availability + rates) ───────────────────────────

  /**
   * Fetches room types with availability and nightly rates from eZee's
   * RoomList reservation API. This single endpoint returns everything:
   * room type names, available room counts per date, base rates, taxes.
   *
   * Uses YYYY-MM-DD date format (not DD/MM/YYYY — tested with eZee API).
   */
  async getRoomInventory(
    propertyId: string,
    checkin: string,
    checkout: string,
  ): Promise<EzeeRoomInventoryResult> {
    const { hotelCode, authCode, baseUrl } = await this.getConnection(propertyId);

    const url = `${baseUrl}${EzeeService.RESERVATION_PATH}?request_type=RoomList&HotelCode=${hotelCode}&APIKey=${authCode}&check_in_date=${checkin}&check_out_date=${checkout}&RoomType=all`;

    const resp = await fetch(url);
    const data = await resp.json();

    // Error check — reservation API returns array; errors have Error Details
    if (!Array.isArray(data)) {
      const errDetails = data?.['Error Details'] ?? data?.Error_Details;
      if (errDetails) {
        throw new EzeeApiError(
          errDetails.Error_Code ?? 'UNKNOWN',
          errDetails.Error_Message ?? JSON.stringify(data),
          'RoomList',
        );
      }
      throw new EzeeApiError('UNEXPECTED', `Unexpected RoomList response: ${JSON.stringify(data).slice(0, 200)}`, 'RoomList');
    }

    // Check if it's an error array
    if (data.length > 0 && data[0]?.['Error Details']) {
      const err = data[0]['Error Details'];
      throw new EzeeApiError(err.Error_Code ?? 'UNKNOWN', err.Error_Message ?? 'Unknown error', 'RoomList');
    }

    const rooms: EzeeRoomInventoryResult['rooms'] = [];

    for (const rt of data) {
      rooms.push({
        roomTypeId: rt.roomtypeunkid,
        roomTypeName: rt.Roomtype_Name,
        availability: Number(rt.min_ava_rooms ?? 0),
        ratePerNight: Number(rt.room_rates_info?.avg_per_night_without_tax ?? 0),
        ratePlanId: rt.roomrateunkid ?? '',
        rateTypeId: rt.ratetypeunkid ?? '',
      });
    }

    this.logger.debug(`eZee RoomList: ${rooms.map(r => `${r.roomTypeName}=${r.availability}@₹${r.ratePerNight}`).join(', ')}`);
    return { rooms };
  }

  // ── 2. Insert Booking ────────────────────────────────────────────────────

  async insertBooking(
    propertyId: string,
    input: EzeeBookingInput,
  ): Promise<EzeeInsertBookingResult> {
    const { hotelCode, authCode, baseUrl } = await this.getConnection(propertyId);

    // Build Room_Details
    const roomDetails: Record<string, any> = {};
    for (let i = 0; i < input.rooms.length; i++) {
      const room = input.rooms[i];
      // eZee requires comma-separated per-night values — one entry per night.
      // All three rate arrays must have the same length as numberOfNights.
      // e.g. 2 nights at ₹500: baserate="500,500", extradultrate="0,0"
      const nights = Math.max(1, room.numberOfNights);
      const rateStr = Array(nights).fill(String(Math.round(room.ratePerNight))).join(',');
      const zeroStr = Array(nights).fill('0').join(',');
      roomDetails[`Room_${i + 1}`] = {
        Rateplan_Id: room.ezeeRatePlanId,
        Ratetype_Id: room.ezeeRateTypeId,
        Roomtype_Id: room.ezeeRoomTypeId,
        baserate: rateStr,
        extradultrate: zeroStr,
        extrachildrate: zeroStr,
        number_adults: String(room.adults),
        number_children: String(room.children),
        ExtraChild_Age: '',
        Title: room.guestTitle,
        First_Name: room.guestFirstName,
        Last_Name: room.guestLastName,
        Gender: room.guestGender,
        SpecialRequest: '',
      };
    }

    const bookingData = JSON.stringify({
      Room_Details: roomDetails,
      check_in_date: input.checkin,
      check_out_date: input.checkout,
      Booking_Payment_Mode: '',
      Email_Address: input.email || '',
      Source_Id: '',
      MobileNo: input.phone || '',
      Address: input.address || '',
      State: input.state || '',
      Country: input.country || 'India',
      City: input.city || '',
      Zipcode: input.zipcode || '',
      Fax: '',
      Device: '',
      Languagekey: 'en',
      paymenttypeunkid: '',
    });

    const url = `${baseUrl}${EzeeService.RESERVATION_PATH}?request_type=InsertBooking&HotelCode=${hotelCode}&APIKey=${authCode}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `BookingData=${encodeURIComponent(bookingData)}`,
    });

    const data = await resp.json();

    if (data.Error_Details || data.error) {
      const errCode = data.Error_Details?.Error_Code ?? data.error?.code ?? 'UNKNOWN';
      const errMsg = data.Error_Details?.Error_Message ?? data.error?.message ?? JSON.stringify(data);
      throw new EzeeApiError(errCode, errMsg, 'InsertBooking');
    }

    if (!data.ReservationNo) {
      throw new EzeeApiError('NO_RESERVATION', `InsertBooking returned no ReservationNo: ${JSON.stringify(data)}`, 'InsertBooking');
    }

    this.logger.log(`eZee InsertBooking: ReservationNo=${data.ReservationNo}`);

    return {
      reservationNo: String(data.ReservationNo),
      subReservationNos: (data.SubReservationNo ?? []).map(String),
      inventoryMode: data.Inventory_Mode ?? '',
      contactUnkid: data.contactunkid ?? '',
    };
  }

  // ── 3. Process Booking (Confirm) ─────────────────────────────────────────

  async processBooking(propertyId: string, reservationNo: string): Promise<void> {
    const { hotelCode, authCode, baseUrl } = await this.getConnection(propertyId);

    const processData = JSON.stringify({
      Action: 'ConfirmBooking',
      ReservationNo: reservationNo,
      Inventory_Mode: 'REGULAR',
      Error_Text: '',
    });

    const url = `${baseUrl}${EzeeService.RESERVATION_PATH}?request_type=ProcessBooking&HotelCode=${hotelCode}&APIKey=${authCode}&Process_Data=${encodeURIComponent(processData)}`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.result !== 'success') {
      throw new EzeeApiError(
        data.Error_Details?.Error_Code ?? 'PROCESS_FAILED',
        data.message ?? JSON.stringify(data),
        'ProcessBooking',
      );
    }

    this.logger.log(`eZee ProcessBooking: confirmed reservation ${reservationNo}`);
  }

  // ── 4. Assign Room ───────────────────────────────────────────────────────

  async assignRoom(propertyId: string, assignments: EzeeRoomAssignment[]): Promise<void> {
    const { hotelCode, authCode, baseUrl } = await this.getConnection(propertyId);

    const body = {
      RES_Request: {
        Request_Type: 'AssignRoom',
        Authentication: { HotelCode: hotelCode, AuthCode: authCode },
        RoomAssign: assignments.map((a) => ({
          BookingId: a.bookingId,
          RoomTypeID: a.roomTypeId,
          RoomID: a.roomId,
        })),
      },
    };

    const resp = await fetch(`${baseUrl}${EzeeService.KIOSK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    this.checkKioskError(data, 'AssignRoom');

    this.logger.log(`eZee AssignRoom: ${assignments.map((a) => `Booking ${a.bookingId} → Room ${a.roomId}`).join(', ')}`);
  }

  // ── 5. Add Payment ───────────────────────────────────────────────────────

  async addPayment(propertyId: string, bookingId: string, amount: number): Promise<string> {
    const { hotelCode, authCode, baseUrl } = await this.getConnection(propertyId);

    const body = {
      RES_Request: {
        Request_Type: 'AddPayment',
        Authentication: { HotelCode: hotelCode, AuthCode: authCode },
        Reservation: [
          {
            BookingId: bookingId,
            PaymentId: EzeeService.PAYMENT_ID_CASH,
            CurrencyId: EzeeService.CURRENCY_ID_INR,
            Payment: String(amount),
          },
        ],
      },
    };

    const resp = await fetch(`${baseUrl}${EzeeService.KIOSK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    this.checkKioskError(data, 'AddPayment');

    const receiptNo = data.Success?.Receipt?.[0]?.ReceiptNo ?? '';
    this.logger.log(`eZee AddPayment: Booking ${bookingId}, ₹${amount}, Receipt=${receiptNo}`);
    return receiptNo;
  }

  // ── 6. Fetch Single Booking ──────────────────────────────────────────────

  async fetchBooking(propertyId: string, bookingId: string): Promise<any> {
    const { hotelCode, authCode, baseUrl } = await this.getConnection(propertyId);

    const body = {
      RES_Request: {
        Request_Type: 'FetchSingleBooking',
        BookingId: bookingId,
        Authentication: { HotelCode: hotelCode, AuthCode: authCode },
      },
    };

    const resp = await fetch(`${baseUrl}${EzeeService.PMS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();

    if (data.error) {
      throw new EzeeApiError(data.error.code, data.error.message, 'FetchSingleBooking');
    }

    return data.Reservations?.Reservation?.[0] ?? null;
  }

  // ── 7. Fetch Reservations by Date Range ──────────────────────────────────

  /**
   * Returns all reservations arriving or in-house between fromDate and toDate.
   * Used by reconciliation to detect cancellations, check-ins, check-outs
   * that happened in eZee outside our system.
   *
   * eZee CurrentStatus values:
   *   "Confirmed Reservation" → CONFIRMED
   *   "Cancelled Reservation" → CANCELLED
   *   "Checked In"            → CHECKED_IN
   *   "Checked Out"           → CHECKED_OUT
   *   "No Show"               → NO_SHOW
   */
  async fetchReservationsByDateRange(
    propertyId: string,
    fromDate: string,
    toDate: string,
  ): Promise<EzeeReservationSummary[]> {
    const { hotelCode, authCode, baseUrl } = await this.getConnection(propertyId);

    // eZee PMS uses "ArrivalList" request type with max 30-day window.
    const body = {
      RES_Request: {
        Request_Type: 'ArrivalList',
        Authentication: { HotelCode: hotelCode, AuthCode: authCode },
        Date: { from_date: fromDate, to_date: toDate },
      },
    };

    const resp = await fetch(`${baseUrl}${EzeeService.PMS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();

    if (data.Errors?.ErrorCode && String(data.Errors.ErrorCode) !== '0') {
      throw new EzeeApiError(data.Errors.ErrorCode, data.Errors.ErrorMessage, 'ArrivalList');
    }

    const reservations = data.Reservations?.Reservation ?? [];
    const results: EzeeReservationSummary[] = [];
    // Multi-room bookings have one BookingTran per room — deduplicate by UniqueID,
    // using the first tran for guest/status info and summing guest counts.
    const seen = new Set<string>();

    for (const res of reservations) {
      const resNo = String(res.UniqueID);
      if (seen.has(resNo)) continue;
      seen.add(resNo);

      const tran = res.BookingTran?.[0];
      if (!tran) continue;

      // Sum adults/children across all trans (multi-room bookings)
      const totalGuests = (res.BookingTran ?? []).reduce(
        (sum: number, t: any) => sum + Number(t.Adult ?? 1) + Number(t.Child ?? 0),
        0,
      );

      results.push({
        reservationNo: resNo,
        status: tran.CurrentStatus ?? '',
        roomName: tran.RoomName ?? null,
        roomTypeId: tran.RoomTypeCode ?? null,
        roomTypeName: tran.RoomTypeName ?? null,
        checkin: tran.Start ?? null,
        checkout: tran.End ?? null,
        firstName: res.FirstName ?? tran.FirstName ?? null,
        lastName: res.LastName ?? tran.LastName ?? null,
        email: res.Email ?? tran.Email ?? null,
        phone: res.Mobile ?? tran.Mobile ?? null,
        source: tran.Source ?? null,
        noOfGuests: totalGuests || 1,
        totalAmountBeforeTax: Number(tran.TotalAmountBeforeTax ?? 0),
      });
    }

    return results;
  }

  // ── Error checking ───────────────────────────────────────────────────────

  private checkKioskError(data: any, endpoint: string): void {
    // Kiosk errors come in two formats
    const errors = data.Errors ?? data.Error;
    if (!errors) return;

    const errorList = Array.isArray(errors) ? errors : [errors];
    for (const err of errorList) {
      const code = err.ErrorCode ?? err.errorCode;
      if (code && code !== '0' && code !== 0) {
        throw new EzeeApiError(String(code), err.ErrorMessage ?? 'Unknown error', endpoint);
      }
    }
  }
}
