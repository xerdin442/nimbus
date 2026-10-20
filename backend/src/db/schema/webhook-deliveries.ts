import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, livemode, timestamps } from './columns';
import { organizationId } from './organizations';
import { webhookEndpoints } from './webhook-endpoints';
import { webhookDeliveryStatusEnum } from './enums';

/**
 * Per mode. One row per endpoint per event occurrence: an event the endpoint is subscribed to
 * is stored once (unique on endpoint + event + entity) and retried until it is accepted.
 * The payload is stored so redeliveries replay the exact bytes that were first sent.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    organizationId: organizationId(),
    livemode: livemode(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    /** The reservation or ticket the event identifies. */
    entityId: uuid('entity_id').notNull(),
    payload: jsonb('payload').notNull(),
    status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** HTTP status of the last attempt; null when the request itself failed. */
    responseCode: integer('response_code'),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('webhook_deliveries_occurrence_unique').on(
      table.endpointId,
      table.event,
      table.entityId,
    ),
    index('webhook_deliveries_recent_idx').on(
      table.endpointId,
      table.createdAt,
    ),
  ],
);
