import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns';
import { organizationId } from './organizations';

export const locations = pgTable(
  'locations',
  {
    id: id(),
    organizationId: organizationId(),
    name: text('name').notNull(),
    address: text('address').notNull(),
    city: text('city').notNull(),
    timezone: text('timezone').notNull(),
    phone: text('phone'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('locations_organization_id_idx').on(table.organizationId)],
);
