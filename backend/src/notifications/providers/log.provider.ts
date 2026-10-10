import { randomUUID } from 'crypto';
import { Logger } from '@src/common/logger';
import { MailMessage, MailProvider } from './mail-provider.interface';

export class LogMailProvider implements MailProvider {
  private readonly logger = Logger(LogMailProvider.name);

  // eslint-disable-next-line @typescript-eslint/require-await
  async send(message: MailMessage): Promise<{ messageId: string }> {
    this.logger.info(
      `[mail] to=${message.to} subject="${message.subject}"\n${message.text}`,
    );
    return { messageId: `log_${randomUUID()}` };
  }
}
