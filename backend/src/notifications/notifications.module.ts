import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrgVerificationModule } from '@src/organizations/org-verification.module';
import { MailConfigController } from './controllers/mail-config.controller';
import { MailConfigService } from './mail-config.service';
import { MailProviderFactory } from './providers/mail-provider.factory';
import { PlatformMailService } from './platform-mail.service';
import { EmailsService } from './emails.service';
import { EmailsListener } from './emails.listener';
import { EmailProcessor } from './emails.processor';
import { EmailDeliveriesController } from './controllers/email-deliveries.controller';
import { EMAILS_QUEUE } from '@src/common/types/constants';

@Module({
  imports: [
    OrgVerificationModule,
    BullModule.registerQueue({ name: EMAILS_QUEUE }),
  ],
  controllers: [MailConfigController, EmailDeliveriesController],
  providers: [
    MailConfigService,
    MailProviderFactory,
    PlatformMailService,
    EmailsService,
    EmailsListener,
    EmailProcessor,
  ],
  exports: [PlatformMailService, MailProviderFactory],
})
export class NotificationsModule {}
