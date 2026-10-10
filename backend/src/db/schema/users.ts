import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, id, timestamps } from './columns';
import { organizationId } from './organizations';
import { roleEnum } from './enums';

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  ...timestamps,
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    role: roleEnum('role').notNull(),
    locationIds: uuid('location_ids').array().notNull().default([]),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('memberships_user_id_unique').on(table.userId),
    index('memberships_organization_id_idx').on(table.organizationId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    organizationId: organizationId(),
    email: text('email').notNull(),
    role: roleEnum('role').notNull(),
    locationIds: uuid('location_ids').array().notNull().default([]),
    tokenHash: text('token_hash').notNull().unique(),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // One open invite per email per org.
    uniqueIndex('invitations_open_email_unique')
      .on(table.organizationId, table.email)
      .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('refresh_tokens_session_id_idx').on(table.sessionId)],
);
