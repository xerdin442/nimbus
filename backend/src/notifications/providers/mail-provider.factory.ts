import { Injectable } from '@nestjs/common';
import type { MailProvider as MailProviderName } from '@src/db/schema/types';
import { MailProvider } from './mail-provider.interface';
import { ResendProvider } from './resend.provider';
import { BrevoProvider } from './brevo.provider';

@Injectable()
export class MailProviderFactory {
  create(provider: MailProviderName, apiKey: string): MailProvider {
    switch (provider) {
      case 'resend':
        return new ResendProvider(apiKey);
      case 'brevo':
        return new BrevoProvider(apiKey);
    }
  }
}
