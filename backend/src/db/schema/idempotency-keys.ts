import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt, id, livemode } from './columns';
import { organizationId } from './organizations';

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    organizationId: organizationId(),
    livemode: livemode(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('idempotency_keys_organization_id_livemode_key_unique').on(
      table.organizationId,
      table.livemode,
      table.key,
    ),
  ],
);
