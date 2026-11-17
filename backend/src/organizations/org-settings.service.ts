import { Injectable } from '@nestjs/common';
import { DbService } from '@src/db/db.service';
import { DEFAULT_ORG_SETTINGS, orgSettings } from '@src/db/schema';
import type {
  OrgSettingsInternal,
  OrgSettingsView,
  TenantContext,
  Transaction,
} from '@src/common/types';
import { UpdateOrgSettingsDto } from './dto/organization.dto';

const settingsColumns = {
  adsMinutes: orgSettings.adsMinutes,
  cleanupMinutes: orgSettings.cleanupMinutes,
  holdMinutes: orgSettings.holdMinutes,
  sendTestEmailsToMe: orgSettings.sendTestEmailsToMe,
  companyLogo: orgSettings.companyLogo,
  emailHeaderImage: orgSettings.emailHeaderImage,
  tiktok: orgSettings.tiktok,
  instagram: orgSettings.instagram,
  facebook: orgSettings.facebook,
  twitter: orgSettings.twitter,
};

const internalColumns = {
  ...settingsColumns,
  companyLogoPublicId: orgSettings.companyLogoPublicId,
  emailHeaderImagePublicId: orgSettings.emailHeaderImagePublicId,
};

@Injectable()
export class OrgSettingsService {
  constructor(private readonly db: DbService) {}

  async read(tx: Transaction): Promise<OrgSettingsView> {
    const [settings] = await tx.select(settingsColumns).from(orgSettings);
    if (settings) return settings;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { companyLogoPublicId, emailHeaderImagePublicId, ...defaults } =
      DEFAULT_ORG_SETTINGS;
    return defaults;
  }

  /** Includes Cloudinary public ids so branding can replace/delete its own assets. */
  async readInternal(tx: Transaction): Promise<OrgSettingsInternal> {
    const [settings] = await tx.select(internalColumns).from(orgSettings);
    return settings ?? { ...DEFAULT_ORG_SETTINGS };
  }

  async get(ctx: TenantContext): Promise<OrgSettingsView> {
    return this.db.withTenant(ctx, (tx) => this.read(tx));
  }

  async getInternal(ctx: TenantContext): Promise<OrgSettingsInternal> {
    return this.db.withTenant(ctx, (tx) => this.readInternal(tx));
  }

  async update(
    ctx: TenantContext,
    dto: UpdateOrgSettingsDto,
  ): Promise<OrgSettingsView> {
    if (!Object.keys(dto).length) {
      return this.get(ctx);
    }

    const [settings] = await this.db.withTenant(ctx, (tx) =>
      tx
        .insert(orgSettings)
        .values({ organizationId: ctx.orgId, ...dto })
        .onConflictDoUpdate({ target: orgSettings.organizationId, set: dto })
        .returning(settingsColumns),
    );
    return settings;
  }

  async updateBranding(
    ctx: TenantContext,
    values: Partial<OrgSettingsInternal>,
  ): Promise<OrgSettingsView> {
    const [settings] = await this.db.withTenant(ctx, (tx) =>
      tx
        .insert(orgSettings)
        .values({ organizationId: ctx.orgId, ...values })
        .onConflictDoUpdate({
          target: orgSettings.organizationId,
          set: values,
        })
        .returning(settingsColumns),
    );
    return settings;
  }
}
