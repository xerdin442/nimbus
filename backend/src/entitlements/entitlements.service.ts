import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { RedisClientType } from 'redis';
import { DbService } from '@src/db/db.service';
import {
  entitlementOverrides,
  organizations,
  plans,
  subscriptions,
} from '@src/db/schema';
import { CodedException } from '@src/common/errors';
import { REDIS_CLIENT } from '@src/common/cache';
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  type EntitlementKey,
  type Entitlements,
  type LimitKey,
  type TestModeLimitKey,
  type Transaction,
} from '@src/common/types';
import {
  BASIC_ENTITLEMENTS,
  ENTITLEMENTS_CACHE_TTL_SECONDS,
  TEST_MODE_LIMITS,
} from './entitlements.constants';

const ENTITLEMENT_KEYS = Object.keys(BASIC_ENTITLEMENTS) as EntitlementKey[];

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly db: DbService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

  /**
   * Effective entitlements: the subscribed plan's defaults, then per-org overrides.
   * Unsubscribed orgs get Basic. While a downgrade is scheduled, numeric limits are lowered
   * to the target plan's so the org can't grow back over them before the switch.
   * Cached for 60s so direct plan/override edits take effect without a restart; billing
   * webhooks clear it immediately.
   */
  async getAll(orgId: string): Promise<Entitlements> {
    const cacheKey = this.cacheKey(orgId);
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached) as Entitlements;
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    const effective = await this.db.withTenant(
      { orgId, livemode: true },
      async (tx) => {
        const [subscription] = await tx
          .select({
            planId: subscriptions.planId,
            pendingPlanId: subscriptions.pendingPlanId,
          })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.organizationId, orgId),
              inArray(subscriptions.status, ACTIVE_SUBSCRIPTION_STATUSES),
            ),
          )
          .orderBy(desc(subscriptions.startedAt))
          .limit(1);

        const overrides = await tx
          .select({
            key: entitlementOverrides.key,
            value: entitlementOverrides.value,
          })
          .from(entitlementOverrides)
          .where(eq(entitlementOverrides.organizationId, orgId));

        const currentPlan = subscription
          ? await this.planEntitlements(tx, subscription.planId)
          : null;
        const entitlements = this.effective(currentPlan, overrides);

        if (subscription?.pendingPlanId) {
          const pending = await this.planEntitlements(
            tx,
            subscription.pendingPlanId,
          );
          this.lowerNumeric(entitlements, this.effective(pending, overrides));
        }

        return entitlements;
      },
    );

    await this.redis.set(cacheKey, JSON.stringify(effective), {
      expiration: { type: 'EX', value: ENTITLEMENTS_CACHE_TTL_SECONDS },
    });
    return effective;
  }

  /** Effective entitlements for an arbitrary plan, used to check a downgrade before it starts. */
  async forPlan(orgId: string, planId: string): Promise<Entitlements> {
    return this.db.withTenant({ orgId, livemode: true }, async (tx) => {
      const overrides = await tx
        .select({
          key: entitlementOverrides.key,
          value: entitlementOverrides.value,
        })
        .from(entitlementOverrides)
        .where(eq(entitlementOverrides.organizationId, orgId));

      return this.effective(await this.planEntitlements(tx, planId), overrides);
    });
  }

  async get<K extends EntitlementKey>(
    orgId: string,
    key: K,
  ): Promise<Entitlements[K]> {
    return (await this.getAll(orgId))[key];
  }

  async clear(orgId: string): Promise<void> {
    await this.redis.del(this.cacheKey(orgId));
  }

  /**
   * Throws `403 plan_limit_reached` if creating one more resource would exceed the limit.
   *
   * Must run inside the transaction that inserts the resource. It first locks the org row,
   * so concurrent creates for the same org queue up behind each other
   */
  async assertWithinLimit(
    tx: Transaction,
    orgId: string,
    key: LimitKey | TestModeLimitKey,
    count: (tx: Transaction) => Promise<number>,
  ): Promise<void> {
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update');

    const limit =
      key in TEST_MODE_LIMITS
        ? TEST_MODE_LIMITS[key as TestModeLimitKey]
        : await this.get(orgId, key as LimitKey);
    const current = await count(tx);

    if (current >= limit) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        'plan_limit_reached',
        `Your plan allows ${limit} for ${key}`,
        { key, limit, current },
      );
    }
  }

  private async planEntitlements(
    tx: Transaction,
    planId: string,
  ): Promise<Partial<Entitlements> | null> {
    const [plan] = await tx
      .select({ entitlements: plans.entitlements })
      .from(plans)
      .where(eq(plans.id, planId))
      .limit(1);
    return plan?.entitlements ?? null;
  }

  private effective(
    plan: Partial<Entitlements> | null,
    overrides: { key: EntitlementKey; value: boolean | number }[],
  ): Entitlements {
    const entitlements = this.fromPlan(BASIC_ENTITLEMENTS);
    if (plan) {
      this.merge(entitlements, plan);
    }
    for (const override of overrides) {
      this.mergeKey(entitlements, override.key, override.value);
    }
    return entitlements;
  }

  /** A scheduled downgrade caps numeric limits at the target plan until it takes effect. */
  private lowerNumeric(target: Entitlements, pending: Entitlements): void {
    for (const key of ENTITLEMENT_KEYS) {
      if (typeof target[key] === 'number' && typeof pending[key] === 'number') {
        Object.assign(target, {
          [key]: Math.min(target[key], pending[key]),
        });
      }
    }
  }

  private cacheKey(orgId: string): string {
    return `entitlements:${orgId}`;
  }

  private fromPlan(source: Partial<Entitlements>): Entitlements {
    const entitlements: Entitlements = { ...BASIC_ENTITLEMENTS };
    this.merge(entitlements, source);
    return entitlements;
  }

  private merge(target: Entitlements, source: Partial<Entitlements>): void {
    for (const key of ENTITLEMENT_KEYS) {
      const value = source[key];
      if (value !== undefined) {
        this.mergeKey(target, key, value);
      }
    }
  }

  private mergeKey(
    target: Entitlements,
    key: EntitlementKey,
    value: boolean | number,
  ): void {
    if (typeof value !== typeof BASIC_ENTITLEMENTS[key]) return;
    Object.assign(target, { [key]: value });
  }
}
