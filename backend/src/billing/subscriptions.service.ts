import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { RedisClientType } from 'redis';
import { DbService } from '@src/db/db.service';
import { plans, subscriptions } from '@src/db/schema';
import { REDIS_CLIENT } from '@src/common/cache';
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  ActiveSubscriptionStatus,
  CurrentSubscription,
} from '@src/common/types';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly db: DbService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

  async canUseLive(orgId: string): Promise<boolean> {
    const cacheKey = this.cacheKey(orgId);
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      return cached === '1';
    }

    const subscription = await this.getCurrent(orgId);
    const allowed =
      subscription !== null &&
      ACTIVE_SUBSCRIPTION_STATUSES.includes(
        subscription.status as ActiveSubscriptionStatus,
      );
    await this.redis.set(cacheKey, allowed ? '1' : '0', {
      expiration: { type: 'EX', value: 60 },
    });

    return allowed;
  }

  async getCurrent(orgId: string): Promise<CurrentSubscription | null> {
    return this.db.withTenant({ orgId, livemode: true }, async (tx) => {
      const [row] = await tx
        .select({ subscription: subscriptions, plan: plans })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(
          and(
            eq(subscriptions.organizationId, orgId),
            inArray(subscriptions.status, ACTIVE_SUBSCRIPTION_STATUSES),
          ),
        )
        .orderBy(desc(subscriptions.startedAt))
        .limit(1);

      return row ? { ...row.subscription, plan: row.plan } : null;
    });
  }

  async clear(orgId: string): Promise<void> {
    await this.redis.del(this.cacheKey(orgId));
  }

  private cacheKey(orgId: string): string {
    return `subscription:active:${orgId}`;
  }
}
