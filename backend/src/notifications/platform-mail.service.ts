import { Injectable } from '@nestjs/common';
import { Secrets } from '@src/common/secrets';
import { MailProvider } from './providers/mail-provider.interface';
import { ResendProvider } from './providers/resend.provider';
import { LogMailProvider } from './providers/log.provider';
import type { RenderedEmail } from '@src/common/types';

@Injectable()
export class PlatformMailService {
  private readonly provider: MailProvider =
    Secrets.PLATFORM_MAIL_DRIVER === 'resend'
      ? new ResendProvider(Secrets.RESEND_API_KEY)
      : new LogMailProvider();

  async send(to: string, email: RenderedEmail): Promise<{ messageId: string }> {
    return this.provider.send({
      from: Secrets.PLATFORM_MAIL_FROM,
      to,
      ...email,
    });
  }
}
