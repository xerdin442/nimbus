import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import {
  CurrentMembership,
  CurrentTenant,
} from '@src/common/decorators/request.decorators';
import { RequiresFeature } from '@src/common/decorators/requires-feature.decorator';
import type { MembershipContext, TenantContext } from '@src/common/types';
import { BrandingService } from '../branding.service';
import { OrganizationsService } from '../organizations.service';
import { OrgSettingsService } from '../org-settings.service';
import {
  UpdateOrganizationDto,
  UpdateOrgSettingsDto,
} from '../dto/organization.dto';
import { UpdateBrandingDto } from '../dto/branding.dto';

@Controller('dashboard/organization')
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly settings: OrgSettingsService,
    private readonly branding: BrandingService,
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

  @Patch('settings/branding')
  @Dashboard('owner')
  @RequiresFeature('email.branding')
  updateBranding(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpdateBrandingDto,
  ) {
    return this.branding.updateSocials(tenant, dto);
  }

  @Post('settings/branding/logo')
  @HttpCode(HttpStatus.OK)
  @Dashboard('owner')
  @RequiresFeature('email.branding')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  uploadLogo(
    @CurrentTenant() tenant: TenantContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.branding.upload(tenant, file, 'logo');
  }

  @Delete('settings/branding/logo')
  @Dashboard('owner')
  @RequiresFeature('email.branding')
  removeLogo(@CurrentTenant() tenant: TenantContext) {
    return this.branding.remove(tenant, 'logo');
  }

  @Post('settings/branding/image')
  @HttpCode(HttpStatus.OK)
  @Dashboard('owner')
  @RequiresFeature('email.branding')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  uploadHeaderImage(
    @CurrentTenant() tenant: TenantContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.branding.upload(tenant, file, 'header');
  }

  @Delete('settings/branding/image')
  @Dashboard('owner')
  @RequiresFeature('email.branding')
  removeHeaderImage(@CurrentTenant() tenant: TenantContext) {
    return this.branding.remove(tenant, 'header');
  }
}
