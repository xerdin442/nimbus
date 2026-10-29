// ── BullMQ queues and their job names ───────────────────────────────────────────────────────────

export const AUTH_QUEUE = 'auth';
/** Daily: deletes long-revoked or idle sessions and expired refresh tokens. */
export const SESSION_CLEANUP_JOB = 'session-cleanup';

export const RESERVATIONS_QUEUE = 'reservations';
/** Fires at a hold's `expiresAt` (jobId `expire-<reservationId>`). */
export const EXPIRE_JOB = 'expire';
/** Automatic refund, e.g. after a showtime is cancelled (jobId `refund-<reservationId>`). */
export const REFUND_JOB = 'refund';

export const PAYMENTS_QUEUE = 'payments';
/** Handles one stored provider webhook (jobId `event-<paymentEventId>`). */
export const PROCESS_EVENT_JOB = 'process-event';
/** After a broken key is reconnected: verifies pending payments with the provider. */
export const RECONCILE_JOB = 'reconcile';

export const WEBHOOKS_QUEUE = 'webhooks';
/** Points one stored delivery at its endpoint URL (jobId `deliver-<deliveryId>`). */
export const DELIVER_JOB = 'deliver';

export const BILLING_QUEUE = 'billing';
/** Daily: refreshes local plan prices/intervals from Paystack. */
export const SYNC_PLANS_JOB = 'sync-plans';

export const EMAILS_QUEUE = 'emails';
/** One attempt at sending a stored email (jobId `email-<deliveryId>-<timestamp>`). */
export const SEND_EMAIL_JOB = 'send-email';
/** One attempt at sending a platform alert email. */
export const SEND_ALERT_JOB = 'send-alert';

// ── In-process domain events (EventEmitter2) ────────────────────────────────────────────────────

export const SHOWTIME_CANCELLED = 'showtime.cancelled';

export const PAYMENT_SUCCEEDED = 'payment.succeeded';
export const REFUND_FAILED = 'refund.failed';

/** Outgoing webhooks and customer emails listen to these. */
export const RESERVATION_CONFIRMED = 'reservation.confirmed';
export const RESERVATION_CANCELLED = 'reservation.cancelled';
export const RESERVATION_EXPIRED = 'reservation.expired';
export const RESERVATION_REFUNDED = 'reservation.refunded';
export const TICKET_CHECKED_IN = 'ticket.checked_in';
/** Paid after its seats were gone (or the showtime closed): the payment is refunded. */
export const RESERVATION_PAYMENT_CONFLICT = 'reservation.payment_conflict';
