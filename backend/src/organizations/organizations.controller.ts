import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import {
  CurrentMembership,
  CurrentTenant,
} from '@src/common/decorators/request.decorators';
import type { MembershipContext, TenantContext } from '@src/common/types';
import { OrganizationsService } from './organizations.service';
import { OrgSettingsService } from './org-settings.service';
import {
  UpdateOrganizationDto,
  UpdateOrgSettingsDto,
} from './dto/organization.dto';

@Controller('dashboard/organization')
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly settings: OrgSettingsService,
  ) {}

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

  @Get('settings')
  @Dashboard()
  getSettings(@CurrentTenant() tenant: TenantContext) {
    return this.settings.get(tenant);
  }

  @Patch('settings')
  @Dashboard('owner')
  updateSettings(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpdateOrgSettingsDto,
  ) {
    return this.settings.update(tenant, dto);
  }
}
