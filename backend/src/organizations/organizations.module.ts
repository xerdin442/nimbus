import { Module } from '@nestjs/common';
import { NotificationsModule } from '@src/notifications/notifications.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [NotificationsModule],
  controllers: [OrganizationsController, MembersController],
  providers: [OrganizationsService, MembersService],
  exports: [OrganizationsService, MembersService],
})
export class OrganizationsModule {}
