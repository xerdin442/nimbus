import { pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['owner', 'manager', 'staff']);

export const apiKeyTypeEnum = pgEnum('api_key_type', ['publishable', 'secret']);

export const configStatusEnum = pgEnum('config_status', ['verified', 'broken']);

export const paymentProviderEnum = pgEnum('payment_provider', ['paystack']);

export const mailProviderEnum = pgEnum('mail_provider', ['resend', 'brevo']);

export const seatTypeEnum = pgEnum('seat_type', [
  'standard',
  'vip',
  'couple',
  'wheelchair',
]);
