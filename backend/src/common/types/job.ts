import type { RefundReason } from '@src/db/schema/types';

/** BullMQ job data. Each carries the org and mode, so the job runs inside withTenant. */

interface BaseJob {
  orgId: string;
  livemode: boolean;
}

export interface ExpireReservationJob extends BaseJob {
  reservationId: string;
}

export interface ProcessPaymentEventJob extends BaseJob {
  eventId: string;
}

export interface ReconcilePaymentsJob extends BaseJob {
  /** ISO time: pending payments created after `since` are verified with the provider. */
  since: string;
}

export interface RefundReservationJob extends BaseJob {
  reservationId: string;
  reason: RefundReason;
}

export interface DeliverWebhookJob extends BaseJob {
  deliveryId: string;
}
