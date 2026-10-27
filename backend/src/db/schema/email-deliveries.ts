import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, livemode, timestamps } from './columns';
import { organizationId } from './organizations';
import { reservations } from './reservations';
import {
  emailDeliveryStatusEnum,
  emailFailureReasonEnum,
  emailTypeEnum,
  mailProviderEnum,
} from './enums';

/**
 * Per mode. One row per reservation per email type: a retry updates the same
 * row instead of inserting another, so a customer is never emailed twice for
 * the same thing. Content is re-rendered at send time, never stored.
 */
export const emailDeliveries = pgTable(
  'email_deliveries',
  {
    id: id(),
    organizationId: organizationId(),
    livemode: livemode(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    type: emailTypeEnum('type').notNull(),
    /** Where it went: the customer, or the notification email for a test-mode send to me. */
    to: text('to').notNull(),
    provider: mailProviderEnum('provider'),
    providerMessageId: text('provider_message_id'),
    status: emailDeliveryStatusEnum('status').notNull().default('queued'),
    /** Why it failed or was skipped; decides whether the dashboard retry button is shown. */
    failureReason: emailFailureReasonEnum('failure_reason'),
    lastError: text('last_error'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptedAt: timestamp('last_attempted_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('email_deliveries_reservation_type_unique').on(
      table.reservationId,
      table.type,
    ),
    index('email_deliveries_recent_idx').on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);
