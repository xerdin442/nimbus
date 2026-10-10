import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, livemode, timestamps } from './columns';
import { organizationId } from './organizations';
import {
  configStatusEnum,
  mailProviderEnum,
  paymentProviderEnum,
} from './enums';

export const paymentConfigs = pgTable(
  'payment_configs',
  {
    id: id(),
    organizationId: organizationId(),
    livemode: livemode(),
    provider: paymentProviderEnum('provider').notNull(),
    encryptedSecret: text('encrypted_secret').notNull(),
    last4: text('last4').notNull(),
    status: configStatusEnum('status').notNull().default('verified'),
    lastError: text('last_error'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('payment_configs_organization_id_livemode_unique').on(
      table.organizationId,
      table.livemode,
    ),
  ],
);

export const mailConfigs = pgTable('mail_configs', {
  id: id(),
  organizationId: organizationId().unique(),
  provider: mailProviderEnum('provider').notNull(),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  fromEmail: text('from_email').notNull(),
  fromName: text('from_name').notNull(),
  replyTo: text('reply_to'),
  status: configStatusEnum('status').notNull().default('verified'),
  lastError: text('last_error'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  ...timestamps,
});
