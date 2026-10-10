import {
  apiKeyTypeEnum,
  configStatusEnum,
  mailProviderEnum,
  paymentProviderEnum,
  roleEnum,
  seatTypeEnum,
} from './enums';
import { organizations } from './organizations';
import {
  invitations,
  memberships,
  refreshTokens,
  sessions,
  users,
} from './users';
import { apiKeys } from './api-keys';
import { mailConfigs, paymentConfigs } from './provider-configs';
import { locations } from './locations';
import { screens, seatLayouts, seats } from './screens';
import { movies } from './movies';
import { webhookEndpoints } from './webhook-endpoints';

// ── Enums ───────────────────────────────────────────────────────────────────────────────────────

export const ROLES = roleEnum.enumValues;
export type Role = (typeof ROLES)[number];

export const API_KEY_TYPES = apiKeyTypeEnum.enumValues;
export type ApiKeyType = (typeof API_KEY_TYPES)[number];

export const CONFIG_STATUSES = configStatusEnum.enumValues;
export type ConfigStatus = (typeof CONFIG_STATUSES)[number];

export const PAYMENT_PROVIDERS = paymentProviderEnum.enumValues;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const MAIL_PROVIDERS = mailProviderEnum.enumValues;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export const SEAT_TYPES = seatTypeEnum.enumValues;
export type SeatType = (typeof SEAT_TYPES)[number];

// ── Row and insert types ──────────────────────────────────────────────

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type PaymentConfig = typeof paymentConfigs.$inferSelect;
export type NewPaymentConfig = typeof paymentConfigs.$inferInsert;

export type MailConfig = typeof mailConfigs.$inferSelect;
export type NewMailConfig = typeof mailConfigs.$inferInsert;

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;

export type Screen = typeof screens.$inferSelect;
export type NewScreen = typeof screens.$inferInsert;

export type SeatLayout = typeof seatLayouts.$inferSelect;
export type NewSeatLayout = typeof seatLayouts.$inferInsert;

export type Seat = typeof seats.$inferSelect;
export type NewSeat = typeof seats.$inferInsert;

export type Movie = typeof movies.$inferSelect;
export type NewMovie = typeof movies.$inferInsert;

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
