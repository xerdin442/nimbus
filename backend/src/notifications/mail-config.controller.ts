import { Body, Controller, Get, Put } from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import {
  CurrentMembership,
  CurrentUser,
} from '@src/common/decorators/request.decorators';
import type { MembershipContext } from '@src/common/types';
import { MailConfigService } from './mail-config.service';
import { ConnectMailConfigDto } from './dto/mail-config.dto';

@Dashboard('owner')
@Controller('dashboard/mail-config')
export class MailConfigController {
  constructor(private readonly mailConfig: MailConfigService) {}

  @Get()
  get(@CurrentMembership() membership: MembershipContext) {
    return this.mailConfig.get(membership.orgId);
  }

  @Put()
  connect(
    @CurrentMembership() membership: MembershipContext,
    @CurrentUser() user: { id: string },
    @Body() dto: ConnectMailConfigDto,
  ) {
    return this.mailConfig.connect(membership.orgId, user.id, dto);
  }
}
