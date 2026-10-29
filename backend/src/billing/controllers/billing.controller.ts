import { Controller, Get } from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import { CurrentMembership } from '@src/common/decorators/request.decorators';
import type { MembershipContext } from '@src/common/types';
import { BillingOverviewService } from '../billing-overview.service';

@Controller('dashboard/billing')
export class BillingController {
  constructor(private readonly billing: BillingOverviewService) {}

  @Get()
  @Dashboard('owner')
  get(@CurrentMembership() membership: MembershipContext) {
    return this.billing.get(membership.orgId);
  }
}
