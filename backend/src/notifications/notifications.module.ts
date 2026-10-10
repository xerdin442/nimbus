import { Module } from '@nestjs/common';
import { OrgVerificationModule } from '@src/organizations/org-verification.module';
import { MailConfigController } from './mail-config.controller';
import { MailConfigService } from './mail-config.service';
import { MailProviderFactory } from './providers/mail-provider.factory';
import { PlatformMailService } from './platform-mail.service';

@Module({
  imports: [OrgVerificationModule],
  controllers: [MailConfigController],
  providers: [MailConfigService, MailProviderFactory, PlatformMailService],
  exports: [PlatformMailService, MailProviderFactory],
})
export class NotificationsModule {}
