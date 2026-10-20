import {
  apiKeyTypeEnum,
  configStatusEnum,
  mailProviderEnum,
  paymentMethodEnum,
  paymentProviderEnum,
  paymentStatusEnum,
  refundReasonEnum,
  refundStatusEnum,
  reservationChannelEnum,
  reservationStatusEnum,
  roleEnum,
  seatTypeEnum,
  showtimeSeatStatusEnum,
  showtimeStatusEnum,
  webhookDeliveryStatusEnum,
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
import { webhookDeliveries } from './webhook-deliveries';
import { orgSettings } from './org-settings';
import { showtimes, showtimeSeats } from './showtimes';
import { reservations, tickets } from './reservations';
import { paymentEvents, payments } from './payments';
import { idempotencyKeys } from './idempotency-keys';
import { refunds } from './refunds';

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

export const SHOWTIME_STATUSES = showtimeStatusEnum.enumValues;
export type ShowtimeStatus = (typeof SHOWTIME_STATUSES)[number];

export const SHOWTIME_SEAT_STATUSES = showtimeSeatStatusEnum.enumValues;
export type ShowtimeSeatStatus = (typeof SHOWTIME_SEAT_STATUSES)[number];

export const RESERVATION_STATUSES = reservationStatusEnum.enumValues;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_CHANNELS = reservationChannelEnum.enumValues;
export type ReservationChannel = (typeof RESERVATION_CHANNELS)[number];

export const PAYMENT_METHODS = paymentMethodEnum.enumValues;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = paymentStatusEnum.enumValues;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const WEBHOOK_DELIVERY_STATUSES = webhookDeliveryStatusEnum.enumValues;
export type DeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export const REFUND_STATUSES = refundStatusEnum.enumValues;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_REASONS = refundReasonEnum.enumValues;
export type RefundReason = (typeof REFUND_REASONS)[number];

/** Minor units per seat type. A showtime prices every seat type its layout uses. */
export type SeatPrices = Partial<Record<SeatType, number>>;

// ── Row and insert types ──────────────────────────────────────────────

export type Organization = typeof organizations.$inferSelect;

export type User = typeof users.$inferSelect;

export type Membership = typeof memberships.$inferSelect;

export type Invitation = typeof invitations.$inferSelect;

export type Session = typeof sessions.$inferSelect;

export type RefreshToken = typeof refreshTokens.$inferSelect;

export type ApiKey = typeof apiKeys.$inferSelect;

export type PaymentConfig = typeof paymentConfigs.$inferSelect;

export type MailConfig = typeof mailConfigs.$inferSelect;

export type Location = typeof locations.$inferSelect;

export type Screen = typeof screens.$inferSelect;

export type SeatLayout = typeof seatLayouts.$inferSelect;

export type Seat = typeof seats.$inferSelect;

export type Movie = typeof movies.$inferSelect;

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

export type OrgSettings = typeof orgSettings.$inferSelect;

export type Showtime = typeof showtimes.$inferSelect;
export type NewShowtime = typeof showtimes.$inferInsert;

export type ShowtimeSeat = typeof showtimeSeats.$inferSelect;

export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;

export type Payment = typeof payments.$inferSelect;

export type Ticket = typeof tickets.$inferSelect;

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;

export type Refund = typeof refunds.$inferSelect;

export type PaymentEvent = typeof paymentEvents.$inferSelect;
