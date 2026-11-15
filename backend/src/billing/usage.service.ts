import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '@src/common/cache';
import { CodedException } from '@src/common/errors';
import { Logger } from '@src/common/logger';
import { Secrets } from '@src/common/secrets';
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  type Entitlements,
  type TenantContext,
  type TicketUsage,
  type Transaction,
} from '@src/common/types';
import { DbService } from '@src/db/db.service';
import {
  organizations,
  reservations,
  subscriptions,
  usageCounters,
} from '@src/db/schema';
import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { PlatformMailService } from '@src/notifications/platform-mail.service';
import {
  ticketUsageOverEmail,
  ticketUsageWarningEmail,
} from '@src/notifications/templates';
import { USAGE_KEY, USAGE_WARNING_RATIO } from './billing.constants';

/**
 * The usage month is anchored to the subscription start day (e.g. the 15th) and resets
 * monthly for annual plans too. Clamps to the last day for starts on the 29th–31st.
 */
export const usagePeriodStart = (startedAt: Date, now = new Date()): Date => {
  const day = startedAt.getUTCDate();
  const clamp = (year: number, month: number) => {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
  };

  const thisMonth = clamp(now.getUTCFullYear(), now.getUTCMonth());
  return thisMonth.getTime() > now.getTime()
    ? clamp(now.getUTCFullYear(), now.getUTCMonth() - 1)
    : thisMonth;
};

@Injectable()
export class UsageService {
  private readonly logger = Logger(UsageService.name);

  constructor(
    private readonly db: DbService,
    private readonly entitlements: EntitlementsService,
    private readonly mail: PlatformMailService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

  /**
   * Hard stop check for a new live reservation, counting confirmed tickets plus seats still held.
   */
  async assertWithinQuota(
    tx: Transaction,
    ctx: TenantContext,
    seats: number,
  ): Promise<void> {
    if (!ctx.livemode) return;

    const entitlements = await this.entitlements.getAll(ctx.orgId);
    const hardStop = this.hardStop(entitlements);
    const periodStart = usagePeriodStart(
      (await this.subscriptionStartedAt(tx, ctx.orgId)) ?? new Date(),
    );
    const current = await this.usedInPeriod(tx, periodStart);

    if (current + seats > hardStop) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        'ticket_quota_exceeded',
        `Your plan allows ${hardStop} live tickets this month`,
        {
          limit: entitlements['tickets.monthly'],
          hardStop,
          current,
        },
      );
    }
  }

  /** Increments the usage counter in the transaction that confirms a live reservation. */
  async record(
    tx: Transaction,
    ctx: TenantContext,
    seats: number,
  ): Promise<TicketUsage | null> {
    if (!ctx.livemode || seats <= 0) return null;

    const startedAt = await this.subscriptionStartedAt(tx, ctx.orgId);
    const periodStart = usagePeriodStart(startedAt ?? new Date());

    const [row] = await tx
      .insert(usageCounters)
      .values({
        organizationId: ctx.orgId,
        key: USAGE_KEY,
        periodStart,
        value: seats,
      })
      .onConflictDoUpdate({
        target: [
          usageCounters.organizationId,
          usageCounters.key,
          usageCounters.periodStart,
        ],
        set: { value: sql`${usageCounters.value} + ${seats}` },
      })
      .returning({ value: usageCounters.value });

    const entitlements = await this.entitlements.getAll(ctx.orgId);
    return {
      used: row.value,
      limit: entitlements['tickets.monthly'],
      hardStop: this.hardStop(entitlements),
      periodStart,
    };
  }

  /** 80% warning and 100% over-plan alert, at most one of each per usage month. */
  async evaluateAlerts(ctx: TenantContext, usage: TicketUsage): Promise<void> {
    if (!ctx.livemode || usage.limit <= 0) return;

    const warningAt = Math.ceil(usage.limit * USAGE_WARNING_RATIO);
    if (usage.used >= usage.limit) {
      await this.alert(ctx, usage, 'over');
    } else if (usage.used >= warningAt) {
      await this.alert(ctx, usage, 'warning');
    }
  }

  async summary(
    orgId: string,
    entitlements: Entitlements,
    startedAt: Date | null,
  ): Promise<TicketUsage> {
    const periodStart = usagePeriodStart(startedAt ?? new Date());
    const used = await this.db.withTenant(
      { orgId, livemode: true },
      async (tx) => {
        const [row] = await tx
          .select({ value: usageCounters.value })
          .from(usageCounters)
          .where(
            and(
              eq(usageCounters.organizationId, orgId),
              eq(usageCounters.key, USAGE_KEY),
              eq(usageCounters.periodStart, periodStart),
            ),
          );
        return row?.value ?? 0;
      },
    );

    return {
      used,
      limit: entitlements['tickets.monthly'],
      hardStop: this.hardStop(entitlements),
      periodStart,
    };
  }

  private async usedInPeriod(
    tx: Transaction,
    periodStart: Date,
  ): Promise<number> {
    const [counter] = await tx
      .select({ value: usageCounters.value })
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.key, USAGE_KEY),
          eq(usageCounters.periodStart, periodStart),
        ),
      );

    const [held] = await tx
      .select({
        seats: sql<number>`coalesce(sum(cardinality(${reservations.seatIds})), 0)::int`,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.status, 'pending'),
          sql`${reservations.expiresAt} > now()`,
        ),
      );

    return (counter?.value ?? 0) + (held?.seats ?? 0);
  }

  private async subscriptionStartedAt(
    tx: Transaction,
    orgId: string,
  ): Promise<Date | null> {
    const [row] = await tx
      .select({ startedAt: subscriptions.startedAt })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, orgId),
          inArray(subscriptions.status, ACTIVE_SUBSCRIPTION_STATUSES),
        ),
      )
      .orderBy(desc(subscriptions.startedAt))
      .limit(1);
    return row?.startedAt ?? null;
  }

  private hardStop(entitlements: Entitlements): number {
    const limit = entitlements['tickets.monthly'];
    const pct = entitlements['tickets.hard_stop_pct'];
    return Math.floor(limit * (1 + pct / 100));
  }

  private async alert(
    ctx: TenantContext,
    usage: TicketUsage,
    kind: 'warning' | 'over',
  ): Promise<void> {
    const period = usage.periodStart.toISOString().slice(0, 10);
    const key = `billing:tickets:${ctx.orgId}:${period}:${kind}`;
    const claimed = await this.redis.set(key, '1', {
      condition: 'NX',
      expiration: { type: 'EX', value: 32 * 24 * 60 * 60 },
    });
    if (claimed === null) return;

    const [org] = await this.db.client
      .select({
        name: organizations.name,
        notificationEmail: organizations.notificationEmail,
      })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId));
    if (!org) return;

    const billingUrl = `${Secrets.DASHBOARD_URL.replace(/\/+$/, '')}/billing`;
    const email =
      kind === 'over'
        ? ticketUsageOverEmail({
            orgName: org.name,
            used: usage.used,
            limit: usage.limit,
            billingUrl,
          })
        : ticketUsageWarningEmail({
            orgName: org.name,
            used: usage.used,
            limit: usage.limit,
            billingUrl,
          });

    try {
      await this.mail.send(org.notificationEmail, email);
    } catch (error) {
      this.logger.error(
        `Ticket usage ${kind} email to org ${ctx.orgId} failed: ${String(error)}`,
      );
    }
  }
}
