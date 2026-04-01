import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EzeeApiError,
  EzeeBookingInput,
  EzeeInsertBookingResult,
  EzeeRoomAssignment,
  EzeeRoomAvailabilityResult,
  EzeeRoomInventoryResult,
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

  // ── Date helpers ─────────────────────────────────────────────────────────

  /** Convert YYYY-MM-DD to DD/MM/YYYY (eZee format) */
  private toEzeeDate(isoDate: string): string {
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
  }

  // ── 1. Room Availability ─────────────────────────────────────────────────

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
   * Fetches room type inventory with availability counts and nightly rates
   * from eZee's RetrieveRoomInventory reservation API.
   * Returns the minimum availability and average rate across all nights.
   */
  async getRoomInventory(
    propertyId: string,
    checkin: string,
    checkout: string,
  ): Promise<EzeeRoomInventoryResult> {
    const { hotelCode, authCode, baseUrl } = await this.getConnection(propertyId);

    const url = `${baseUrl}${EzeeService.RESERVATION_PATH}?request_type=RetrieveRoomInventory&HotelCode=${hotelCode}&APIKey=${authCode}&FromDate=${this.toEzeeDate(checkin)}&ToDate=${this.toEzeeDate(checkout)}`;

    const resp = await fetch(url);
    const data = await resp.json();

    // Error check — reservation API errors
    if (data.Error_Details) {
      throw new EzeeApiError(
        data.Error_Details.Error_Code ?? 'UNKNOWN',
        data.Error_Details.Error_Message ?? JSON.stringify(data),
        'RetrieveRoomInventory',
      );
    }

    // Response shape: { "RoomTypeID": { "RoomTypeName": "...", "DD/MM/YYYY": { "Availability": "5", "RatePlanID": { "Rate": "449", ... } } } }
    const rooms: EzeeRoomInventoryResult['rooms'] = [];

    for (const [roomTypeId, roomData] of Object.entries(data)) {
      if (typeof roomData !== 'object' || roomData === null) continue;
      const rd = roomData as any;
      if (!rd.RoomTypeName) continue;

      let minAvailability = Infinity;
      let totalRate = 0;
      let rateCount = 0;
      let ratePlanId = '';
      let rateTypeId = '';

      for (const [key, dateData] of Object.entries(rd)) {
        if (key === 'RoomTypeName') continue;
        const dd = dateData as any;
        if (dd?.Availability !== undefined) {
          const avail = Number(dd.Availability);
          if (avail < minAvailability) minAvailability = avail;

          // Extract rate from the first rate plan found
          for (const [rpKey, rpVal] of Object.entries(dd)) {
            if (rpKey === 'Availability') continue;
            const rp = rpVal as any;
            if (rp?.Rate !== undefined) {
              totalRate += Number(rp.Rate);
              rateCount++;
              if (!ratePlanId) {
                ratePlanId = rpKey;
                rateTypeId = rp.RateTypeId ?? rpKey;
              }
              break; // use first rate plan
            }
          }
        }
      }

      if (minAvailability === Infinity) continue;

      rooms.push({
        roomTypeId,
        roomTypeName: rd.RoomTypeName,
        availability: minAvailability,
        ratePerNight: rateCount > 0 ? Math.round(totalRate / rateCount) : 0,
        ratePlanId,
        rateTypeId,
      });
    }

    this.logger.debug(`eZee RoomInventory: ${rooms.map(r => `${r.roomTypeName}=${r.availability}@₹${r.ratePerNight}`).join(', ')}`);
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
      const totalRate = room.ratePerNight * room.numberOfNights;
      roomDetails[`Room_${i + 1}`] = {
        Rateplan_Id: room.ezeeRatePlanId,
        Ratetype_Id: room.ezeeRateTypeId,
        Roomtype_Id: room.ezeeRoomTypeId,
        baserate: String(totalRate),
        extradultrate: '0',
        extrachildrate: '0',
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
