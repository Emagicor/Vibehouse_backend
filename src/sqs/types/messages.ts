/**
 * TypeScript interfaces for all SQS message payloads.
 * Each message has a `type` discriminator, `payload`, and `timestamp`.
 */

// ── Base envelope ───────────────────────────────────────────────────────────

export interface SqsMessageEnvelope<T extends string = string, P = unknown> {
  type: T;
  payload: P;
  timestamp: number;
}

// ── Audit Log ───────────────────────────────────────────────────────────────

export interface AuditLogPayload {
  actor_type: 'ADMIN' | 'GUEST' | 'SYSTEM';
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value?: Record<string, unknown>;
  new_value?: Record<string, unknown>;
  ip_address?: string;
}

// ── Payment Success ─────────────────────────────────────────────────────────

export interface PaymentSuccessPayload {
  eri: string;
  payment_id: string;
  razorpay_payment_id: string;
  amount: number;
  purpose: string;
  guest_id: string;
  property_id: string;
  items?: {
    product_name: string;
    quantity: number;
    total: number;
  }[];
}

// ── Booking Confirmed ───────────────────────────────────────────────────────

export interface BookingConfirmedPayload {
  eri: string;
  payment_id: string;
  guest_id: string;
  room_type: string | null;
  checkin: Date | string | null;
  checkout: Date | string | null;
}

// ── Ticket Created ──────────────────────────────────────────────────────────

export interface TicketCreatedPayload {
  eri: string;
  guest_id: string;
  property_id: string;
  request_type: 'FREE' | 'BORROWABLE' | 'CHARGEABLE' | 'MAINTENANCE';
  service_name: string;
  room_number: string | null;
  unit_code: string | null;
  department: string;
  priority: string;
}

// ── Low Stock Alert ─────────────────────────────────────────────────────────

export interface LowStockAlertPayload {
  property_id: string;
  product_id: string;
  product_name: string;
  available_stock: number;
  threshold: number;
}

// ── eZee Sync Messages ─────────────────────────────────────────────────────

export interface EzeeInsertBookingPayload {
  eri: string;
  guest_id: string;
  property_id: string;
  room_type: string | null;
  checkin: string | null;
  checkout: string | null;
  amount: number;
}

export interface EzeeAddExtraChargePayload {
  eri: string;
  property_id: string;
  items: {
    product_name: string;
    quantity: number;
    amount: number;
  }[];
  razorpay_payment_id: string;
}

export interface EzeeUpdateReservationPayload {
  eri: string;
  property_id: string;
  updates: Record<string, unknown>;
}

export interface EzeeInsertColiveBookingPayload {
  draft_booking_id: string;
  property_id: string;
  room_type_id: string;
  guest_first_name: string;
  guest_last_name: string;
  guest_email: string;
  guest_phone: string;
  move_in_date: string;     // YYYY-MM-DD
  move_out_date: string;    // YYYY-MM-DD
  rate_per_night: number;
  total_nights: number;
  amount: number;
}

// ── Notification Messages ───────────────────────────────────────────────────

export interface NotifyGuestPayload {
  guest_id: string;
  guest_phone?: string;
  guest_email?: string;
  template: string;
  variables: Record<string, string>;
}

export interface NotifyStaffPayload {
  staff_phone: string;
  staff_name: string;
  template: string;
  variables: Record<string, string>;
}

// ── SLA Escalation ──────────────────────────────────────────────────────────

export interface SlaEscalatePayload {
  ticket_id: string;
  zoho_ticket_id: string;
  escalation_level: 'L0' | 'L1' | 'L2' | 'L3';
}
