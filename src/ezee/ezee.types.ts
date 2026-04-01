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
