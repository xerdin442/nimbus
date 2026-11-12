import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import { CurrentMembership } from '@src/common/decorators/request.decorators';
import type { MembershipContext } from '@src/common/types';
import { BillingOverviewService } from '../../billing-overview.service';
import { BillingService } from '../../billing.service';
import { SubscribeDto } from '../../dto/billing.dto';

@Dashboard('owner')
@Controller('dashboard/billing')
export class BillingController {
  constructor(
    private readonly overview: BillingOverviewService,
    private readonly billing: BillingService,
  ) {}

  @Get()
  get(@CurrentMembership() membership: MembershipContext) {
    return this.overview.get(membership.orgId);
  }

  @Post('subscribe')
  subscribe(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: SubscribeDto,
  ) {
    return this.billing.subscribe(membership.orgId, dto);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentMembership() membership: MembershipContext) {
    return this.billing.cancel(membership.orgId);
  }

  @Post('pay-now')
  @HttpCode(HttpStatus.OK)
  payNow(@CurrentMembership() membership: MembershipContext) {
    return this.billing.payNow(membership.orgId);
  }

  @Get('manage-link')
  manageLink(@CurrentMembership() membership: MembershipContext) {
    return this.billing.manageLink(membership.orgId);
  }

  @Post('manage-email')
  @HttpCode(HttpStatus.OK)
  manageEmail(@CurrentMembership() membership: MembershipContext) {
    return this.billing.sendManageEmail(membership.orgId);
  }
}
