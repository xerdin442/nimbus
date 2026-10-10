import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { apiKeys } from '@src/db/schema';
import type { ApiKey, ApiKeyType } from '@src/db/schema/types';
import type { ApiKeyView, TenantContext, Transaction } from '@src/common/types';
import { EncryptionService } from '@src/common/helpers';
import { randomAlphanumeric } from '@src/common/util';
import { EntitlementsService } from '@src/entitlements/entitlements.service';

export const generateApiKey = (type: ApiKeyType, livemode: boolean) =>
  `${type === 'publishable' ? 'pk' : 'sk'}_${livemode ? 'live' : 'test'}_${randomAlphanumeric(32)}`;

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly db: DbService,
    private readonly encryption: EncryptionService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(ctx: TenantContext): Promise<ApiKeyView[]> {
    const rows = await this.db.client
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.organizationId, ctx.orgId),
          eq(apiKeys.livemode, ctx.livemode),
        ),
      )
      .orderBy(desc(apiKeys.createdAt));

    return rows.map((row) => this.toView(row));
  }

  async create(ctx: TenantContext, userId: string, type: ApiKeyType) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.entitlements.assertWithinLimit(
        tx,
        ctx.orgId,
        ctx.livemode ? 'api_keys.live.max' : 'api_keys.test.max',
        (t) => this.countActive(t, ctx),
      );

      return this.insertKey(tx, ctx, userId, type);
    });
  }

  async roll(ctx: TenantContext, userId: string, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const [old] = await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(this.activeKey(ctx, id))
        .returning();

      if (!old) {
        throw new NotFoundException('Active API key not found');
      }

      return this.insertKey(tx, ctx, userId, old.type);
    });
  }

  async revoke(ctx: TenantContext, id: string): Promise<ApiKeyView> {
    const [revoked] = await this.db.client
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(this.activeKey(ctx, id))
      .returning();

    if (!revoked) {
      throw new NotFoundException('Active API key not found');
    }

    return this.toView(revoked);
  }

  private async insertKey(
    tx: Transaction,
    ctx: TenantContext,
    userId: string,
    type: ApiKeyType,
  ) {
    const key = generateApiKey(type, ctx.livemode);

    const [row] = await tx
      .insert(apiKeys)
      .values({
        organizationId: ctx.orgId,
        type,
        livemode: ctx.livemode,
        prefix: key.slice(0, 12),
        last4: key.slice(-4),
        keyHash: this.encryption.hash(key),
        createdByUserId: userId,
      })
      .returning();

    return { ...this.toView(row), key };
  }

  private async countActive(tx: Transaction, ctx: TenantContext) {
    const [{ total }] = await tx
      .select({ total: count() })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.organizationId, ctx.orgId),
          eq(apiKeys.livemode, ctx.livemode),
          isNull(apiKeys.revokedAt),
        ),
      );
    return total;
  }

  private activeKey(ctx: TenantContext, id: string) {
    return and(
      eq(apiKeys.id, id),
      eq(apiKeys.organizationId, ctx.orgId),
      eq(apiKeys.livemode, ctx.livemode),
      isNull(apiKeys.revokedAt),
    );
  }

  private toView(row: ApiKey): ApiKeyView {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { keyHash, organizationId, ...view } = row;
    return view;
  }
}
