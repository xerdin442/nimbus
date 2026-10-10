export interface PaymentProvider {
  /** Resolves if the key is accepted; throws PaymentProviderError otherwise. */
  verifyCredentials(secretKey: string): Promise<void>;
}

/** - `auth`: key rejected (401/403).
 * - `unavailable`: provider down / timeout — key not judged. */
export type PaymentFailureKind = 'auth' | 'unavailable';

export class PaymentProviderError extends Error {
  constructor(
    readonly kind: PaymentFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
