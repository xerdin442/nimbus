import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { webhookEndpoints } from '@src/db/schema';
import type { WebhookEndpoint } from '@src/db/schema/types';
import type {
  TenantContext,
  Transaction,
  WebhookEndpointWithSecret,
  WebhookEndpointView,
} from '@src/common/types';
import { EncryptionService } from '@src/common/helpers';
import { EntitlementsService } from '@src/entitlements/entitlements.service';
import type { WebhookEventType } from './webhook-events';
import { generateEndpointSecret } from './signature';
import {
  CreateWebhookEndpointDto,
  UpdateWebhookEndpointDto,
} from './dto/webhook-endpoint.dto';

@Injectable()
export class EndpointsService {
  constructor(
    private readonly db: DbService,
    private readonly encryption: EncryptionService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(ctx: TenantContext): Promise<WebhookEndpointView[]> {
    const rows = await this.db.withTenant(ctx, (tx) =>
      tx
        .select()
        .from(webhookEndpoints)
        .orderBy(desc(webhookEndpoints.createdAt), desc(webhookEndpoints.id)),
    );
    return rows.map((row) => this.toView(row));
  }

  async create(
    ctx: TenantContext,
    dto: CreateWebhookEndpointDto,
  ): Promise<WebhookEndpointWithSecret> {
    return this.db.withTenant(ctx, async (tx) => {
      await this.entitlements.assertWithinLimit(
        tx,
        ctx.orgId,
        ctx.livemode
          ? 'webhook_endpoints.live.max'
          : 'webhook_endpoints.test.max',
        (t) => this.countEndpoints(t, ctx),
      );

      return this.insert(tx, ctx, dto.url, dto.events);
    });
  }

  async rotate(
    ctx: TenantContext,
    id: string,
  ): Promise<WebhookEndpointWithSecret> {
    const secret = generateEndpointSecret();

    const [row] = await this.db.withTenant(ctx, (tx) =>
      tx
        .update(webhookEndpoints)
        .set({ secret: this.encryption.encrypt(secret) })
        .where(eq(webhookEndpoints.id, id))
        .returning(),
    );

    if (!row) {
      throw new NotFoundException('Webhook endpoint not found');
    }
    return { ...this.toView(row), secret };
  }

  async update(
    ctx: TenantContext,
    id: string,
    dto: UpdateWebhookEndpointDto,
  ): Promise<WebhookEndpointView> {
    const [row] = await this.db.withTenant(ctx, (tx) =>
      tx
        .update(webhookEndpoints)
        .set(dto)
        .where(eq(webhookEndpoints.id, id))
        .returning(),
    );

    if (!row) {
      throw new NotFoundException('Webhook endpoint not found');
    }
    return this.toView(row);
  }

  async remove(ctx: TenantContext, id: string): Promise<void> {
    const deleted = await this.db.withTenant(ctx, (tx) =>
      tx
        .delete(webhookEndpoints)
        .where(eq(webhookEndpoints.id, id))
        .returning({ id: webhookEndpoints.id }),
    );

    if (!deleted.length) {
      throw new NotFoundException('Webhook endpoint not found');
    }
  }

  private async insert(
    tx: Transaction,
    ctx: TenantContext,
    url: string,
    events: WebhookEventType[],
  ): Promise<WebhookEndpointWithSecret> {
    const secret = generateEndpointSecret();

    const [row] = await tx
      .insert(webhookEndpoints)
      .values({
        organizationId: ctx.orgId,
        livemode: ctx.livemode,
        url,
        events,
        secret: this.encryption.encrypt(secret),
      })
      .returning();

    return { ...this.toView(row), secret };
  }

  private async countEndpoints(tx: Transaction, ctx: TenantContext) {
    const [{ total }] = await tx
      .select({ total: count() })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.organizationId, ctx.orgId),
          eq(webhookEndpoints.livemode, ctx.livemode),
        ),
      );
    return total;
  }

  private toView(row: WebhookEndpoint): WebhookEndpointView {
    return { ...row };
  }
}
