import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import { CurrentMembership } from '@src/common/decorators/request.decorators';
import type { MembershipContext } from '@src/common/types';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto } from './dto/organization.dto';

@Controller('dashboard/organization')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @Dashboard()
  get(@CurrentMembership() membership: MembershipContext) {
    return this.organizations.get(membership.orgId);
  }

  @Patch()
  @Dashboard('owner')
  update(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizations.update(membership.orgId, dto);
  }
}
