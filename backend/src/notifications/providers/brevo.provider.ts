import {
  MailMessage,
  MailProvider,
  MailProviderError,
} from './mail-provider.interface';

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const TIMEOUT_MS = 10_000;

export const parseAddress = (
  value: string,
): { name?: string; email: string } => {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  return match
    ? { name: match[1] || undefined, email: match[2] }
    : { email: value.trim() };
};

export class BrevoProvider implements MailProvider {
  constructor(private readonly apiKey: string) {}

  async send(message: MailMessage): Promise<{ messageId: string }> {
    let response: Response;

    try {
      response = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: parseAddress(message.from),
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
          ...(message.replyTo && { replyTo: { email: message.replyTo } }),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new MailProviderError(
        'unavailable',
        `Brevo request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const body = (await response.json().catch(() => ({}))) as {
      messageId?: string;
      message?: string;
    };

    if (response.ok) {
      return { messageId: body.messageId ?? 'unknown' };
    }

    const detail = body.message ?? `HTTP ${response.status}`;

    if (response.status === 401 || response.status === 403) {
      throw new MailProviderError('auth', detail);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new MailProviderError('unavailable', detail);
    }
    throw new MailProviderError('rejected', detail);
  }
}
