import type { Request } from 'express';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@src/db/schema';
import type {
  ApiKey,
  ApiKeyType,
  ConfigStatus,
  Invitation,
  MailConfig,
  PaymentConfig,
  Role,
  SeatLayout,
  SeatType,
  Session,
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
