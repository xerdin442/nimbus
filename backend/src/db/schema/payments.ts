import {
  char,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, livemode, timestamps } from './columns';
import { organizationId } from './organizations';
import { reservations } from './reservations';
import {
  paymentMethodEnum,
  paymentProviderEnum,
  paymentStatusEnum,
} from './enums';

/** Per mode. One row per payment attempt; a box-office sale is one succeeded cash/pos row. */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    organizationId: organizationId(),
    livemode: livemode(),
    /** Null for verification payments, online/cash/pos payments always have one. */
    reservationId: uuid('reservation_id').references(() => reservations.id, {
      onDelete: 'cascade',
    }),
    /** Null for box-office methods. */
    provider: paymentProviderEnum('provider'),
    method: paymentMethodEnum('method').notNull(),
    /** The platform tx identifier sent to the provider on checkout (`nmb-…`); webhooks and verify look payments up by it. */
    reference: text('reference'),
    /** The provider's transaction id, once paid. */
    providerTransactionId: text('provider_transaction_id'),
    amount: integer('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    status: paymentStatusEnum('status').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('payments_reservation_id_idx').on(table.reservationId),
    uniqueIndex('payments_organization_id_livemode_reference_unique').on(
      table.organizationId,
      table.livemode,
      table.reference,
    ),
  ],
);

/**
 * Per mode. Every inbound provider webhook, stored raw. The unique key makes processing idempotent:
 * a redelivered event fails to insert and is acknowledged without being handled twice.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: id(),
    organizationId: organizationId(),
    livemode: livemode(),
    provider: paymentProviderEnum('provider').notNull(),
    eventType: text('event_type').notNull(),
    /**
     * Paystack: `data.id` for charges. Refund events carry no id, only the transaction reference,
     * which identifies them because there is one (full) refund per payment.
     */
    providerEventId: text('provider_event_id').notNull(),
    /** Platform payment reference, for finding a payment's events. */
    reference: text('reference'),
    payload: jsonb('payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('payment_events_dedupe_unique').on(
      table.organizationId,
      table.livemode,
      table.provider,
      table.eventType,
      table.providerEventId,
    ),
  ],
);
