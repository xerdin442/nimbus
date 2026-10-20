import {
  RESERVATION_CANCELLED,
  RESERVATION_CONFIRMED,
  RESERVATION_EXPIRED,
  RESERVATION_REFUNDED,
  TICKET_CHECKED_IN,
} from '@src/common/types/constants';

/**
 * The events an org can receive by webhook. The envelope:
 *
 * ```json
 * { "event": "reservation.confirmed", "livemode": false, "createdAt": "…", "data": { … } }
 * ```
 */
export const WEBHOOK_EVENTS = [
  RESERVATION_CONFIRMED,
  RESERVATION_CANCELLED,
  RESERVATION_EXPIRED,
  RESERVATION_REFUNDED,
  TICKET_CHECKED_IN,
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

/** What is stored in the delivery row and posted to the endpoint's URL. */
export interface WebhookPayload {
  event: WebhookEventType;
  livemode: boolean;
  createdAt: Date;
  data: unknown;
}
