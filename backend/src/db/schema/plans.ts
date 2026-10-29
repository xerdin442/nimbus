import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { Entitlements } from '@src/common/types';
import { id, timestamps } from './columns';
import { planIntervalEnum, planTierEnum } from './enums';

/**
 * A Paystack plan registered in Nimbus. Global table: no RLS. `key` is Nimbus's stable
 * identifier (e.g. `basic_monthly`); `planCode` is filled from the deployment's env mapping and
 * kept in sync with Paystack by PlanSyncService.
 */
export const plans = pgTable(
  'plans',
  {
    id: id(),
    key: text('key').notNull().unique(),
    planCode: text('plan_code').unique(),
    name: text('name').notNull(),
    tier: planTierEnum('tier').notNull(),
    interval: planIntervalEnum('interval').notNull(),
    isPublic: boolean('is_public').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    /** Default entitlements for subscribers; per-org overrides are merged over these. */
    entitlements: jsonb('entitlements')
      .$type<Partial<Entitlements>>()
      .notNull(),
    /** Mirrored from Paystack for display; the provider remains the source of truth. */
    amount: integer('amount'),
    currency: char('currency', { length: 3 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('plans_tier_interval_idx').on(table.tier, table.interval)],
);
