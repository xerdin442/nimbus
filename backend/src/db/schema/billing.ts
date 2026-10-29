import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { EntitlementKey } from '@src/common/types';
import { createdAt, id, timestamps } from './columns';
import { organizations } from './organizations';
import { plans } from './plans';
import { paymentProviderEnum, subscriptionStatusEnum } from './enums';

/**
 * The org's billing relationship. Billing is platform-level (Nimbus's Paystack account), so these
 * rows are tenant-scoped but not test/live-scoped. One current subscription per org is expected,
 * though history stays for audit.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    /** Set for a scheduled downgrade; takes effect on the old plan's next payment date. */
    pendingPlanId: uuid('pending_plan_id').references(() => plans.id, {
      onDelete: 'set null',
    }),
    provider: paymentProviderEnum('provider').notNull().default('paystack'),
    providerCustomerCode: text('provider_customer_code'),
    providerSubscriptionCode: text('provider_subscription_code').unique(),
    /** Paystack's email token, needed to disable the subscription. */
    providerEmailToken: text('provider_email_token'),
    status: subscriptionStatusEnum('status').notNull(),
    currentPeriodStart: timestamp('current_period_start', {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    nextPaymentDate: timestamp('next_payment_date', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('subscriptions_organization_id_status_idx').on(
      table.organizationId,
      table.status,
    ),
  ],
);

/** A per-org value merged over its plan defaults. Hand-edited for Enterprise/goodwill changes. */
export const entitlementOverrides = pgTable(
  'entitlement_overrides',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').$type<EntitlementKey>().notNull(),
    value: jsonb('value').$type<boolean | number>().notNull(),
    reason: text('reason').notNull(),
    setBy: text('set_by').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('entitlement_overrides_organization_id_key_unique').on(
      table.organizationId,
      table.key,
    ),
  ],
);

/** Live ticket volume per usage month; keyed by the subscription-anchored period. */
export const usageCounters = pgTable(
  'usage_counters',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    value: integer('value').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('usage_counters_organization_id_key_period_unique').on(
      table.organizationId,
      table.key,
      table.periodStart,
    ),
  ],
);

/**
 * Every inbound Paystack billing webhook, stored raw and deduped like payment_events.
 * Global table (allowlisted): the handler runs before an org context is known.
 */
export const billingEvents = pgTable(
  'billing_events',
  {
    id: id(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    provider: paymentProviderEnum('provider').notNull().default('paystack'),
    eventType: text('event_type').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    subscriptionCode: text('subscription_code'),
    planCode: text('plan_code'),
    payload: jsonb('payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('billing_events_dedupe_unique').on(
      table.provider,
      table.eventType,
      table.providerEventId,
    ),
    index('billing_events_organization_id_idx').on(table.organizationId),
  ],
);
