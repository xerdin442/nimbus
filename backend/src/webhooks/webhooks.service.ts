import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  and,
  arrayContains,
  count,
  desc,
  eq,
  gte,
  lte,
  type SQL,
} from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { DbService } from '@src/db/db.service';
import { webhookDeliveries, webhookEndpoints } from '@src/db/schema';
import type { WebhookDelivery } from '@src/db/schema/types';
import { Logger } from '@src/common/logger';
import { EncryptionService } from '@src/common/helpers';
import type {
  PaginatedResult,
  TenantContext,
  Transaction,
  WebhookDeliveryView,
} from '@src/common/types';
import type { DeliverWebhookJob } from '@src/common/types/job';
import { DELIVER_JOB, WEBHOOKS_QUEUE } from '@src/common/types/constants';
import { buildWebhookPayload } from './payloads';
import { signPayload } from './signature';
import type { WebhookEventType, WebhookPayload } from './webhook-events';
import { ListWebhookDeliveriesQueryDto } from './dto/webhook-delivery.dto';
import { REQUEST_TIMEOUT_MS } from '@src/common/util';

@Injectable()
export class WebhooksService {
  private readonly logger = Logger(WebhooksService.name);

  constructor(
    private readonly db: DbService,
    private readonly encryption: EncryptionService,
    @InjectQueue(WEBHOOKS_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Sent from domain events (`webhooks.listener.ts`). One delivery row per enabled endpoint
   * subscribed to `event`; an event sent twice (a retried payment job re-announces it)
   * reuses its row, so the endpoint sees the payload once per occurrence.
   */
  async dispatch(
    ctx: TenantContext,
    event: WebhookEventType,
    entityId: string,
  ): Promise<void> {
    const deliveryIds = await this.db.withTenant(ctx, async (tx) => {
      const endpoints = await tx
        .select({ id: webhookEndpoints.id })
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.enabled, true),
            arrayContains(webhookEndpoints.events, [event]),
          ),
        );
      if (!endpoints.length) return [];

      const payload = await buildWebhookPayload(
        tx,
        event,
        ctx.livemode,
        entityId,
      );
      if (!payload) return [];

      const ids: string[] = [];
      for (const endpoint of endpoints) {
        const id = await this.insertDelivery(
          tx,
          ctx,
          endpoint.id,
          event,
          entityId,
          payload,
        );
        if (id) ids.push(id);
      }
      return ids;
    });

    await this.schedule(ctx, deliveryIds);
  }

  /**
   * The `deliver` job: one attempt at an endpoint's URL. 2xx closes the row;
   * anything else fails it and rethrows, so BullMQ retries with backoff.
   */
  async deliver(ctx: TenantContext, deliveryId: string): Promise<void> {
    const target = await this.db.withTenant(ctx, (tx) =>
      tx
        .select({
          delivery: webhookDeliveries,
          url: webhookEndpoints.url,
          encryptedSecret: webhookEndpoints.secret,
        })
        .from(webhookDeliveries)
        .innerJoin(
          webhookEndpoints,
          eq(webhookEndpoints.id, webhookDeliveries.endpointId),
        )
        .where(eq(webhookDeliveries.id, deliveryId)),
    );
    const [{ delivery, url, encryptedSecret }] = target;

    // A re-delivered job for a closed row is a no-op.
    if (!delivery || delivery.status === 'success') return;

    const body = JSON.stringify(delivery.payload);
    let responseCode: number | null = null;
    let lastError: string | null = null;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Nimbus-Webhooks/1.0',
          'nimbus-signature': signPayload(
            this.encryption.decrypt(encryptedSecret),
            body,
          ),
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      responseCode = response.status;
      await response.text().catch(() => undefined);

      if (!response.ok) {
        lastError = `Endpoint returned HTTP ${response.status}`;
      }
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : String(error) || 'Request failed';
    }

    await this.db.withTenant(ctx, (tx) =>
      tx
        .update(webhookDeliveries)
        .set({
          attempts: delivery.attempts + 1,
          responseCode,
          lastError,
          ...(responseCode && !lastError
            ? { status: 'success', deliveredAt: new Date() }
            : { status: 'failed' }),
        })
        .where(eq(webhookDeliveries.id, delivery.id)),
    );

    if (responseCode && !lastError) return;

    throw new Error(
      lastError ?? `Webhook endpoint ${url} returned HTTP ${responseCode}`,
    );
  }

  async list(
    ctx: TenantContext,
    query: ListWebhookDeliveriesQueryDto,
  ): Promise<PaginatedResult<WebhookDeliveryView>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filters: (SQL | undefined)[] = [
      query.endpointId
        ? eq(webhookDeliveries.endpointId, query.endpointId)
        : undefined,
      query.event ? eq(webhookDeliveries.event, query.event) : undefined,
      query.status ? eq(webhookDeliveries.status, query.status) : undefined,
      query.startDate
        ? gte(webhookDeliveries.createdAt, query.startDate)
        : undefined,
      query.endDate
        ? lte(webhookDeliveries.createdAt, query.endDate)
        : undefined,
    ];
    const where = and(...filters);

    const [rows, [{ total }]] = await this.db.withTenant(ctx, (tx) =>
      Promise.all([
        tx
          .select()
          .from(webhookDeliveries)
          .where(where)
          .orderBy(
            desc(webhookDeliveries.createdAt),
            desc(webhookDeliveries.id),
          )
          .limit(limit)
          .offset((page - 1) * limit),
        tx.select({ total: count() }).from(webhookDeliveries).where(where),
      ]),
    );

    return {
      data: rows.map((row) => this.toView(row)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * The first time this occurrence reaches this endpoint, a row is stored; a re-announced event
   * (retried payment job) reuses its row and returns it for requeuing only while still pending.
   */
  private async insertDelivery(
    tx: Transaction,
    ctx: TenantContext,
    endpointId: string,
    event: WebhookEventType,
    entityId: string,
    payload: WebhookPayload,
  ): Promise<string | null> {
    const [inserted] = await tx
      .insert(webhookDeliveries)
      .values({
        organizationId: ctx.orgId,
        livemode: ctx.livemode,
        endpointId,
        event,
        entityId,
        payload,
      })
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.id });

    if (inserted) return inserted.id;

    const [existing] = await tx
      .select({
        id: webhookDeliveries.id,
        status: webhookDeliveries.status,
      })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.event, event),
          eq(webhookDeliveries.entityId, entityId),
        ),
      );
    return existing && existing.status === 'pending' ? existing.id : null;
  }

  /** After commit. Scheduling failures shouldn't lose an event silently, so they are logged. */
  private async schedule(ctx: TenantContext, deliveryIds: string[]) {
    for (const id of deliveryIds) {
      const job: DeliverWebhookJob = {
        orgId: ctx.orgId,
        livemode: ctx.livemode,
        deliveryId: id,
      };
      try {
        await this.queue.add(DELIVER_JOB, job, {
          jobId: `deliver-${id}`,
          attempts: 8,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: 1000,
        });
      } catch (error) {
        this.logger.error(
          `Failed to schedule delivery ${id}: ${String(error)}`,
        );
      }
    }
  }

  private toView(row: WebhookDelivery): WebhookDeliveryView {
    return { ...row };
  }
}
