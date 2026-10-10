import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns';
import { organizationId } from './organizations';
import { apiKeyTypeEnum } from './enums';
import { users } from './users';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    organizationId: organizationId(),
    type: apiKeyTypeEnum('type').notNull(),
    livemode: boolean('livemode').notNull(),
    prefix: text('prefix').notNull(),
    last4: text('last4').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('api_keys_organization_id_livemode_idx').on(
      table.organizationId,
      table.livemode,
    ),
  ],
);
