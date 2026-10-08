import { boolean, index, pgTable, text } from 'drizzle-orm/pg-core';
import { id, livemode, timestamps } from './columns';
import { organizationId } from './organizations';

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: id(),
    organizationId: organizationId(),
    livemode: livemode(),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: text('events').array().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index('webhook_endpoints_organization_id_livemode_idx').on(
      table.organizationId,
      table.livemode,
    ),
  ],
);
