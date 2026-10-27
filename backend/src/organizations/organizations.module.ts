import { Module } from '@nestjs/common';
import { NotificationsModule } from '@src/notifications/notifications.module';
import { OrganizationsController } from './controllers/organizations.controller';
import { OrganizationsService } from './organizations.service';
import { MembersController } from './controllers/members.controller';
import { MembersService } from './members.service';
import { OrgSettingsService } from './org-settings.service';

@Module({
  imports: [NotificationsModule],
  controllers: [OrganizationsController, MembersController],
  providers: [OrganizationsService, MembersService, OrgSettingsService],
  exports: [OrganizationsService, MembersService, OrgSettingsService],
})
export class OrganizationsModule {}
