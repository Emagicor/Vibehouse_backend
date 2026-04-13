/**
 * TypeScript types for eZee PMS API requests and responses.
 */

// ── Room Availability ──────────────────────────────────────────────────────

export interface EzeePhysicalRoom {
  roomId: string;
  roomName: string;
}

export interface EzeeRoomTypeAvailability {
  roomTypeId: string;
  roomTypeName: string;
  physicalRooms: EzeePhysicalRoom[];
}

export interface EzeeRoomAvailabilityResult {
  rooms: EzeeRoomTypeAvailability[];
}

// ── Physical Room Catalog (Vacation Rental API) ────────────────────────────
// POST /channelbookings/vacation_rental.php  { request_type: "get_rooms" }
// Returns ALL room types unconditionally — no date range, no availability filter.
// room_id here = roomtypeunkid used in RoomList / InsertBooking APIs.

export interface EzeePhysicalRoomCatalogEntry {
  roomId: string;            // = roomtypeunkid in other APIs
  roomName: string;
  physicalRoomNos: string[]; // e.g. ["106", "107"]
  physicalRoomCodes: string[];// e.g. ["106 : Active", "107 : Active"]
}

export interface EzeePhysicalRoomCatalogResult {
  rooms: EzeePhysicalRoomCatalogEntry[];
}

// ── Room Inventory (availability + rates) ─────────────────────────────────

export interface EzeeRoomInventoryEntry {
  roomTypeId: string;
  roomTypeName: string;
  availability: number;
  ratePerNight: number;
  ratePlanId: string;
  rateTypeId: string;
}

export interface EzeeRoomInventoryResult {
  rooms: EzeeRoomInventoryEntry[];
}

// ── Insert Booking ─────────────────────────────────────────────────────────

export interface EzeeBookingRoom {
  ezeeRoomTypeId: string;
  ezeeRatePlanId: string;
  ezeeRateTypeId: string;
  adults: number;
  children: number;
  ratePerNight: number;
  numberOfNights: number;
  guestTitle: string;
  guestFirstName: string;
  guestLastName: string;
  guestGender: string;
}

export interface EzeeBookingInput {
  checkin: string;   // YYYY-MM-DD (converted to eZee format internally)
  checkout: string;  // YYYY-MM-DD
  email: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zipcode?: string;
  rooms: EzeeBookingRoom[];
}

export interface EzeeInsertBookingResult {
  reservationNo: string;
  subReservationNos: string[];
  inventoryMode: string;
  contactUnkid: string;
}

// ── Assign Room ────────────────────────────────────────────────────────────

export interface EzeeRoomAssignment {
  bookingId: string;
  roomTypeId: string;
  roomId: string;
}

// ── Fetch Reservations (reconciliation) ───────────────────────────────────

export interface EzeeReservationSummary {
  reservationNo: string;
  status: string;
  roomName: string | null;
  roomTypeId: string | null;
  roomTypeName: string | null;
  checkin: string | null;
  checkout: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  noOfGuests: number;
  totalAmountBeforeTax: number;
}

// ── Error ──────────────────────────────────────────────────────────────────

export class EzeeApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly endpoint: string,
  ) {
    super(`eZee API error [${code}] on ${endpoint}: ${message}`);
    this.name = 'EzeeApiError';
  }
}
