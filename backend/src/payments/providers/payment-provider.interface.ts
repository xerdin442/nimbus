import type { RefundStatus } from '@src/db/schema/types';

export interface InitializePaymentInput {
  email: string;
  /** Minor units. */
  amount: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}

export interface InitializedPayment {
  authorizationUrl: string;
  reference: string;
}

export interface ProviderTransaction {
  status: string;
  transactionId: string;
  reference: string;
  amount: number;
  currency: string;
  paidAt: Date | null;
}

export interface ProviderRefund {
  refundId: string;
  status: RefundStatus;
}

export interface PaymentProvider {
  /** Resolves if the key is accepted; throws PaymentProviderError otherwise. */
  verifyCredentials(secretKey: string): Promise<void>;
  initialize(
    secretKey: string,
    input: InitializePaymentInput,
  ): Promise<InitializedPayment>;
  verify(secretKey: string, reference: string): Promise<ProviderTransaction>;
  refund(secretKey: string, reference: string): Promise<ProviderRefund>;
  verifyWebhookSignature(
    secretKey: string,
    rawBody: Buffer,
    signature: string,
  ): boolean;
}

/**
 * - `auth`: key rejected (401/403) → the org's config becomes `broken`.
 * - `rejected`: the provider refused this request (unknown reference, already refunded…).
 * - `unavailable`: provider down / rate limited / timeout — the key isn't judged.
 */
export type PaymentFailureKind = 'auth' | 'rejected' | 'unavailable';

export class PaymentProviderError extends Error {
  constructor(
    readonly kind: PaymentFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
