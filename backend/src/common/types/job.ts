import type { RefundReason } from '@src/db/schema/types';

/** BullMQ job data. Each carries the org and mode, so the job runs inside withTenant. */

export interface ExpireReservationJob {
  orgId: string;
  livemode: boolean;
  reservationId: string;
}

export interface ProcessPaymentEventJob {
  orgId: string;
  livemode: boolean;
  eventId: string;
}

export interface ReconcilePaymentsJob {
  orgId: string;
  livemode: boolean;
  /** ISO time: pending payments created after `since` are verified with the provider. */
  since: string;
}

export interface RefundReservationJob {
  orgId: string;
  livemode: boolean;
  reservationId: string;
  reason: RefundReason;
}
