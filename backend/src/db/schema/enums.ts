import { pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['owner', 'manager', 'staff']);

export const apiKeyTypeEnum = pgEnum('api_key_type', ['publishable', 'secret']);

export const configStatusEnum = pgEnum('config_status', ['verified', 'broken']);

export const paymentProviderEnum = pgEnum('payment_provider', ['paystack']);

export const mailProviderEnum = pgEnum('mail_provider', ['resend', 'brevo']);

export const seatTypeEnum = pgEnum('seat_type', [
  'standard',
  'vip',
  'couple',
  'wheelchair',
]);

export const showtimeStatusEnum = pgEnum('showtime_status', [
  'draft',
  'published',
  'cancelled',
]);

export const showtimeSeatStatusEnum = pgEnum('showtime_seat_status', [
  'available',
  'held',
  'sold',
]);

export const reservationStatusEnum = pgEnum('reservation_status', [
  'pending',
  'confirmed',
  'expired',
  'cancelled',
  'refunded',
]);

export const reservationChannelEnum = pgEnum('reservation_channel', [
  'api',
  'box_office',
]);

/** `online` goes through a payment provider; `cash` and `pos` are box-office methods. */
export const paymentMethodEnum = pgEnum('payment_method', [
  'online',
  'cash',
  'pos',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
]);

export const refundStatusEnum = pgEnum('refund_status', [
  'pending',
  'processing',
  'needs_attention',
  'processed',
  'failed',
]);

/**
 * `requested`: staff refunded from the dashboard. The others are automatic: the showtime was
 * cancelled, a late payment found its seats taken, or a reservation was paid twice.
 */
export const refundReasonEnum = pgEnum('refund_reason', [
  'requested',
  'showtime_cancelled',
  'payment_conflict',
  'duplicate_payment',
]);
