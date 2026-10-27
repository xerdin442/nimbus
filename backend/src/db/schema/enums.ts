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

/**
 * `online` goes through a payment provider; `cash` and `pos` are box-office methods.
 * `verification` is a webhook-verification payment the org pays to prove its Paystack
 * webhook URL works.
 */
export const paymentMethodEnum = pgEnum('payment_method', [
  'online',
  'cash',
  'pos',
  'verification',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
]);

/** One outgoing webhook delivery attempt log: `pending` until an attempt succeeds or is exhausted. */
export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'pending',
  'success',
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

export const emailTypeEnum = pgEnum('email_type', [
  'confirmation',
  'cancellation',
  'refund',
]);

export const emailDeliveryStatusEnum = pgEnum('email_delivery_status', [
  'queued',
  'sent',
  'failed',
  'skipped',
]);

/**
 * Why an email failed or was skipped. `test_mode` and `no_longer_relevant` are skips;
 * the provider values decide whether the dashboard retry button is shown.
 */
export const emailFailureReasonEnum = pgEnum('email_failure_reason', [
  'provider_auth',
  'provider_broken',
  'provider_unavailable',
  'invalid_recipient',
  'test_mode',
  'no_longer_relevant',
]);
