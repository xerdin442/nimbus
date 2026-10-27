import type { RefundReason } from '@src/db/schema/types';
import { OrgAlertKind } from '.';

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

export interface SendEmailJob extends BaseJob {
  deliveryId: string;
}

export interface SendAlertJob {
  key: string;
  kind: OrgAlertKind;
  to: string;
  orgName: string;
  reservationCode?: string;
  currency?: string;
  amount?: number;
  failureReason?: string;
  since?: Date;
}
