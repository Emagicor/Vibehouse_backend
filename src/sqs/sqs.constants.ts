/**
 * SQS Queue URL environment variable keys and message type enums.
 *
 * Queue architecture:
 *   vibehouse-ops.fifo         — Internal ops (audit logs, DB side-effects)
 *   vibehouse-ezee-sync.fifo  — eZee PMS API calls (rate-limited, 1 at a time)
 *   vibehouse-notify           — Outbound notifications (WhatsApp, email, PagerDuty)
 *   vibehouse-sla-escalate     — SLA timer expirations
 *
 * Each has a corresponding DLQ (*-dlq / *-dlq.fifo).
 */

// ── Queue URL env keys ──────────────────────────────────────────────────────

export const SQS_QUEUE_URLS = {
  OPS: 'AWS_SQS_OPS_QUEUE_URL',
  EZEE_SYNC: 'AWS_SQS_EZEE_SYNC_QUEUE_URL',
  NOTIFY: 'AWS_SQS_NOTIFY_QUEUE_URL',
  SLA_ESCALATE: 'AWS_SQS_SLA_QUEUE_URL',
} as const;

// ── Ops queue message types (vibehouse-ops.fifo) ────────────────────────────

export enum OpsMessageType {
  AUDIT_LOG = 'audit_log',
  PAYMENT_SUCCESS = 'payment_success',
  BOOKING_CONFIRMED = 'booking_confirmed',
  TICKET_CREATED = 'ticket_created',
  LOW_STOCK_ALERT = 'low_stock_alert',
}

// ── eZee sync queue message types (vibehouse-ezee-sync.fifo) ────────────────

export enum EzeeSyncMessageType {
  INSERT_BOOKING = 'insert_booking',
  INSERT_COLIVE_BOOKING = 'insert_colive_booking',
  ADD_EXTRA_CHARGE = 'add_extra_charge',
  UPDATE_RESERVATION = 'update_reservation',
  MARK_CHECKED_IN = 'mark_checked_in',
  MARK_CHECKED_OUT = 'mark_checked_out',
  SYNC_CACHE = 'sync_cache',
}

// ── Notify queue message types (vibehouse-notify) ───────────────────────────

export enum NotifyMessageType {
  NOTIFY_GUEST = 'notify_guest',
  NOTIFY_STAFF = 'notify_staff',
  NOTIFY_ESCALATE_L0 = 'notify_escalate_l0',
  NOTIFY_ESCALATE_L1 = 'notify_escalate_l1',
  NOTIFY_ESCALATE_L2 = 'notify_escalate_l2',
  NOTIFY_ESCALATE_L3 = 'notify_escalate_l3',
  PAGERDUTY_RESOLVE = 'pagerduty_resolve',
}

// ── SLA escalation queue message types ──────────────────────────────────────

export enum SlaMessageType {
  SLA_ESCALATE = 'sla_escalate',
}
