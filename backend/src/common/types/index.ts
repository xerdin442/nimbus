import type { Request } from 'express';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@src/db/schema';
import type {
  ApiKey,
  ApiKeyType,
  ConfigStatus,
  Invitation,
  MailConfig,
  Movie,
  OrgSettings,
  PaymentConfig,
  Refund,
  RefundReason,
  Reservation,
  Role,
  Screen,
  SeatLayout,
  SeatType,
  Session,
  Showtime,
  Ticket,
} from '@src/db/schema/types';
import type {
  BASIC_ENTITLEMENTS,
  TEST_MODE_LIMITS,
} from '@src/entitlements/entitlements.constants';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface TenantContext {
  orgId: string;
  livemode: boolean;
}

export interface JwtPayload {
  sub: string;
  /** Session id: which login/device this access token belongs to. */
  sid: string;
}

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
}

export interface MembershipContext {
  orgId: string;
  role: Role;
  /** Empty = all locations. Always empty for owners. */
  locationIds: string[];
  isVerified: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  membership?: MembershipContext;
}

export interface DashboardRequest extends AuthenticatedRequest {
  membership: MembershipContext;
  livemode: boolean;
}

export interface ApiKeyContext {
  id: string;
  orgId: string;
  livemode: boolean;
  type: ApiKeyType;
}

export interface ApiKeyRequest extends Request {
  apiKey: ApiKeyContext;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ClientInfo {
  userAgent?: string;
  ipAddress?: string;
}

export type SessionView = Omit<Session, 'userId' | 'revokedAt'> & {
  current: boolean;
};

export interface VerificationChecklist {
  isVerified: boolean;
  verifiedAt: Date | null;
  paymentConfig: { test: ConfigStatus | null; live: ConfigStatus | null };
  mailConfig: ConfigStatus | null;
}

export const INVITABLE_ROLES = ['manager', 'staff'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export type InvitationView = Omit<Invitation, 'tokenHash'>;

export interface MemberScope {
  role: Role;
  locationIds: string[];
}

export type ApiKeyView = Omit<ApiKey, 'keyHash' | 'organizationId'>;

export type PaymentConfigView = Omit<
  PaymentConfig,
  'encryptedSecret' | 'organizationId'
>;

export type MailConfigView = Omit<
  MailConfig,
  'encryptedApiKey' | 'organizationId'
>;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface SeatCellInput {
  row: number;
  column: number;
  type?: SeatType;
}

export interface LabeledSeat {
  gridRow: number;
  gridColumn: number;
  rowLabel: string;
  number: number;
  type: SeatType;
}

export type LayoutView = SeatLayout & {
  capacity: number;
  seats: LabeledSeat[];
};

export type Entitlements = {
  -readonly [
    K in keyof typeof BASIC_ENTITLEMENTS
  ]: (typeof BASIC_ENTITLEMENTS)[K] extends boolean ? boolean : number;
};

export type EntitlementKey = keyof Entitlements;

export type LimitKey = {
  [K in EntitlementKey]: Entitlements[K] extends number ? K : never;
}[EntitlementKey];

export type TestModeLimitKey = keyof typeof TEST_MODE_LIMITS;

export type OrgSettingsView = Pick<
  OrgSettings,
  'adsMinutes' | 'cleanupMinutes' | 'holdMinutes'
>;

export interface SeatCounts {
  available: number;
  held: number;
  sold: number;
}

/** A showtime with what a listing needs to display it; seat counts are for the request's mode. */
export type ShowtimeView = Omit<Showtime, 'organizationId'> & {
  movie: Pick<
    Movie,
    'id' | 'title' | 'runtimeMinutes' | 'rating' | 'posterUrl'
  >;
  screen: Pick<Screen, 'id' | 'name' | 'format'>;
  currency: string;
  seats: SeatCounts;
};

/** A showtime seat with its label: `id` is the showtime seat id that holds and tickets use. */
export interface InventorySeat extends LabeledSeat {
  id: string;
}

export interface SeatMapView {
  showtimeId: string;
  rows: number;
  columns: number;
  currency: string;
  seats: (InventorySeat & { price: number; available: boolean })[];
}

export type TicketView = Pick<
  Ticket,
  'id' | 'code' | 'checkedInAt' | 'showtimeSeatId'
> & {
  seat: Pick<LabeledSeat, 'rowLabel' | 'number' | 'type'>;
  /** Signed token encoded in the ticket's QR code. */
  qrToken: string;
};

/** Columns kept off reservation responses. */
export type InternalReservationColumns =
  'organizationId' | 'createdByUserId' | 'seatIds' | 'paymentId';

export type RefundView = Pick<
  Refund,
  'id' | 'status' | 'reason' | 'amount' | 'currency' | 'createdAt' | 'updatedAt'
>;

export type ReservationView = Omit<Reservation, InternalReservationColumns> & {
  seats: (InventorySeat & { price: number })[];
  tickets: TicketView[];
  refund: RefundView | null;
};

export const SCAN_RESULTS = [
  'valid',
  'already_used',
  'void',
  'wrong_mode',
  'wrong_location',
  'too_early',
  'not_today',
  'showtime_ended',
  'invalid',
] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];

export interface ScannedTicket {
  id: string;
  code: string;
  seat: Pick<LabeledSeat, 'rowLabel' | 'number' | 'type'>;
  reservationCode: string;
  customerName: string | null;
  movieTitle: string;
  screenName: string;
  startsAt: Date;
  checkedInAt: Date | null;
}

export interface ScanOutcome {
  result: ScanResult;
  /** Present once the ticket is identified (every result but `invalid` and `wrong_mode`). */
  ticket?: ScannedTicket;
}

/** Dashboard reservation search row. */
export type ReservationSummary = Omit<
  Reservation,
  InternalReservationColumns
> & {
  showtime: Pick<Showtime, 'id' | 'startsAt' | 'locationId'>;
  movieTitle: string;
};

export interface QrTokenPayload {
  ticketId: string;
  livemode: boolean;
}

export interface OfflinePayment {
  reservationId: string;
  method: 'cash' | 'pos';
  amount: number;
  currency: string;
}

export interface CheckoutView {
  authorizationUrl: string;
  reference: string;
}

export interface StartCheckoutInput {
  reservationId: string;
  amount: number;
  currency: string;
  email: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}

export type PaymentSettlement =
  'confirmed' | 'conflict' | 'duplicate' | 'no_op';

export interface RefundInput {
  paymentId: string;
  reason: RefundReason;
  note?: string;
  userId?: string;
}

export interface PaystackEvent {
  event?: string;
  data?: {
    id?: number | string;
    status?: string;
    reference?: string;
    transaction_reference?: string;
    amount?: number | string;
    currency?: string;
    paid_at?: string | null;
  };
}
