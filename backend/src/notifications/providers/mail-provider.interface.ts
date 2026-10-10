export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface MailProvider {
  send(message: MailMessage): Promise<{ messageId: string }>;
}

/**
 * - `auth`: the API key is invalid/revoked → the org's config becomes `broken`.
 * - `rejected`: the provider refused this message (bad sender domain, invalid recipient…).
 * - `unavailable`: rate limit, 5xx, timeout — worth one automatic retry.
 */
export type MailFailureKind = 'auth' | 'rejected' | 'unavailable';

export class MailProviderError extends Error {
  constructor(
    readonly kind: MailFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'MailProviderError';
  }
}
