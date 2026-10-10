import { Resend } from 'resend';
import {
  MailFailureKind,
  MailMessage,
  MailProvider,
  MailProviderError,
} from './mail-provider.interface';

const AUTH_ERRORS = new Set([
  'missing_api_key',
  'invalid_api_key',
  'restricted_api_key',
]);

const UNAVAILABLE_ERRORS = new Set([
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
  'internal_server_error',
  'application_error',
]);

export class ResendProvider implements MailProvider {
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(message: MailMessage): Promise<{ messageId: string }> {
    const { data, error } = await this.client.emails.send({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });

    if (error) {
      throw new MailProviderError(
        ResendProvider.classify(error.name),
        error.message,
      );
    }

    return { messageId: data.id };
  }

  static classify(name: string): MailFailureKind {
    if (AUTH_ERRORS.has(name)) return 'auth';
    if (UNAVAILABLE_ERRORS.has(name)) return 'unavailable';
    return 'rejected';
  }
}
