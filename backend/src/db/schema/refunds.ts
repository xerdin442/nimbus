import {
  char,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, livemode, timestamps } from './columns';
import { organizationId } from './organizations';
import { users } from './users';
import { reservations } from './reservations';
import { payments } from './payments';
import { refundReasonEnum, refundStatusEnum } from './enums';

/**
 * Per mode. Full refunds only, so at most one per payment: retrying a failed refund updates the
 * same row. Box-office (cash/POS) refunds are recorded as `processed` straight away.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    organizationId: organizationId(),
    livemode: livemode(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    status: refundStatusEnum('status').notNull(),
    reason: refundReasonEnum('reason').notNull(),
    note: text('note'),
    /** The provider's refund id (Paystack returns it on create; its webhooks don't carry it). */
    providerRefundId: text('provider_refund_id'),
    lastError: text('last_error'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('refunds_payment_id_unique').on(table.paymentId),
    index('refunds_reservation_id_idx').on(table.reservationId),
  ],
);
