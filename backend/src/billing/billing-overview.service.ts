import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, isNull } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import {
  apiKeys,
  invitations,
  locations,
  memberships,
  organizations,
  plans,
  screens,
  webhookEndpoints,
} from '@src/db/schema';
import type { Plan } from '@src/db/schema/types';
import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { SubscriptionsService } from './subscriptions.service';
import {
  BillingOverview,
  CurrentSubscription,
  PlanUsage,
  PlanView,
  SubscriptionView,
} from '@src/common/types';

@Injectable()
export class BillingOverviewService {
  constructor(
    private readonly db: DbService,
    private readonly entitlements: EntitlementsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async get(orgId: string): Promise<BillingOverview> {
    const [publicPlans, current, entitlements, org] = await Promise.all([
      this.db.client
        .select()
        .from(plans)
        .where(and(eq(plans.isPublic, true), eq(plans.isActive, true)))
        .orderBy(asc(plans.tier), asc(plans.interval)),
      this.subscriptions.getCurrent(orgId),
      this.entitlements.getAll(orgId),
      this.db.client
        .select({ billingEmail: organizations.billingEmail })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .then(([row]) => row),
    ]);

    return {
      plans: publicPlans.map((plan) => this.planView(plan)),
      subscription: current ? this.subscriptionView(current) : null,
      entitlements,
      usage: await this.usage(orgId),
      billingEmail: org?.billingEmail ?? null,
    };
  }

  private async usage(orgId: string): Promise<PlanUsage> {
    return this.db.withTenant({ orgId, livemode: true }, async (tx) => {
      const [
        [locationsCount],
        [screensCount],
        [membersCount],
        [pendingInvites],
        [keys],
        [hooks],
      ] = await Promise.all([
        tx
          .select({ total: count() })
          .from(locations)
          .where(isNull(locations.archivedAt)),
        tx
          .select({ total: count() })
          .from(screens)
          .where(isNull(screens.archivedAt)),
        tx
          .select({ total: count() })
          .from(memberships)
          .where(eq(memberships.organizationId, orgId)),
        tx
          .select({ total: count() })
          .from(invitations)
          .where(
            and(
              eq(invitations.organizationId, orgId),
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
              gt(invitations.expiresAt, new Date()),
            ),
          ),
        tx
          .select({ total: count() })
          .from(apiKeys)
          .where(
            and(
              eq(apiKeys.organizationId, orgId),
              eq(apiKeys.livemode, true),
              isNull(apiKeys.revokedAt),
            ),
          ),
        tx
          .select({ total: count() })
          .from(webhookEndpoints)
          .where(eq(webhookEndpoints.livemode, true)),
      ]);

      return {
        locations: locationsCount.total,
        screens: screensCount.total,
        staff: {
          members: membersCount.total,
          pendingInvites: pendingInvites.total,
        },
        liveApiKeys: keys.total,
        liveWebhookEndpoints: hooks.total,
      };
    });
  }

  private planView(row: Plan): PlanView {
    return { ...row };
  }

  private subscriptionView(row: CurrentSubscription): SubscriptionView {
    return { ...row };
  }
}
