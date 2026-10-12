import { Injectable } from '@nestjs/common';
import { DbService } from '@src/db/db.service';
import { DEFAULT_ORG_SETTINGS, orgSettings } from '@src/db/schema';
import type {
  OrgSettingsView,
  TenantContext,
  Transaction,
} from '@src/common/types';
import { UpdateOrgSettingsDto } from './dto/organization.dto';

const settingsColumns = {
  adsMinutes: orgSettings.adsMinutes,
  cleanupMinutes: orgSettings.cleanupMinutes,
  holdMinutes: orgSettings.holdMinutes,
};

@Injectable()
export class OrgSettingsService {
  constructor(private readonly db: DbService) {}

  async read(tx: Transaction): Promise<OrgSettingsView> {
    const [settings] = await tx.select(settingsColumns).from(orgSettings);
    return settings ?? { ...DEFAULT_ORG_SETTINGS };
  }

  async get(ctx: TenantContext): Promise<OrgSettingsView> {
    return this.db.withTenant(ctx, (tx) => this.read(tx));
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
}
