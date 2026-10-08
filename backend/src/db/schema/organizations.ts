import {
  boolean,
  char,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns';

/** The tenant. Global table: no RLS. */
export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  country: char('country', { length: 2 }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  notificationEmail: text('notification_email').notNull(),
  billingEmail: text('billing_email').unique(),
  isVerified: boolean('is_verified').notNull().default(false),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  ...timestamps,
});

/** `organization_id` column for tenant-owned tables. Every table using it must get an RLS policy. */
export const organizationId = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });
