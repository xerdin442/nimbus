import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { organizations, plans, subscriptions } from '@src/db/schema';
import type { Organization, Plan } from '@src/db/schema/types';
import { CodedException } from '@src/common/errors';
import { Secrets } from '@src/common/secrets';
import type {
  ActiveSubscriptionStatus,
  CheckoutView,
  CurrentSubscription,
  LimitKey,
} from '@src/common/types';
import { ACTIVE_SUBSCRIPTION_STATUSES } from '@src/common/types';
import { randomAlphanumeric } from '@src/common/util';
import { OrganizationsService } from '@src/organizations/organizations.service';
import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { BILLING_REFERENCE_PREFIX } from './billing.constants';
import { BillingOverviewService } from './billing-overview.service';
import { PaystackBillingClient } from './paystack-billing.client';
import { SubscriptionsService } from './subscriptions.service';
import { ChangePlanDto, SubscribeDto } from './dto/billing.dto';

const PLAN_TIER_RANK: Record<Plan['tier'], number> = {
  basic: 0,
  pro: 1,
  enterprise: 2,
};

const PLAN_INTERVAL_RANK: Record<Plan['interval'], number> = {
  hourly: 0,
  daily: 1,
  weekly: 2,
  monthly: 3,
  annually: 4,
};

@Injectable()
export class BillingService {
  constructor(
    private readonly db: DbService,
    private readonly billingClient: PaystackBillingClient,
    private readonly subscriptions: SubscriptionsService,
    private readonly entitlements: EntitlementsService,
    private readonly organizations: OrganizationsService,
    private readonly overview: BillingOverviewService,
  ) {}

  async subscribe(orgId: string, input: SubscribeDto): Promise<CheckoutView> {
    const current = await this.subscriptions.getCurrent(orgId);
    if (current) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'subscription_exists',
        'This organization already has a subscription',
      );
    }

    const plan = await this.plan(input.planId);
    if (!plan.planCode) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'plan_not_available',
        'This plan is not connected to Paystack yet',
      );
    }

    let org = await this.organization(orgId);
    if (!org.billingEmail) {
      if (!input.billingEmail) {
        throw new CodedException(
          HttpStatus.BAD_REQUEST,
          'billing_email_required',
          'Add a billing email before subscribing',
        );
      }
      org = await this.organizations.setBillingEmail(orgId, input.billingEmail);
    } else if (
      input.billingEmail &&
      input.billingEmail.toLowerCase() !== org.billingEmail
    ) {
      org = await this.organizations.setBillingEmail(orgId, input.billingEmail);
    }

    const reference = `${BILLING_REFERENCE_PREFIX}${randomAlphanumeric(24)}`;
    return this.billingClient.initialize({
      email: org.billingEmail!,
      planCode: plan.planCode,
      reference,
      callbackUrl: this.callbackUrl(reference),
      metadata: { orgId, planId: plan.id },
    });
  }

  /**
   * Basic → Pro (or monthly → annual): Paystack has no proration, so a fresh billing cycle
   * starts on the new plan. The old subscription is disabled only once the new one is
   * confirmed, so a failed payment never leaves the org with nothing.
   */
  async upgrade(orgId: string, input: ChangePlanDto): Promise<CheckoutView> {
    const current = await this.activeSubscription(orgId);
    const plan = await this.plan(input.planId);

    if (this.planRank(plan) <= this.planRank(current.plan)) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'not_an_upgrade',
        'Choose a plan above your current one; use downgrade for a lower plan',
      );
    }
    if (!plan.planCode) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'plan_not_available',
        'This plan is not connected to Paystack yet',
      );
    }

    const org = await this.ensureBillingEmail(orgId, input.billingEmail);
    const reference = `${BILLING_REFERENCE_PREFIX}${randomAlphanumeric(24)}`;
    return this.billingClient.initialize({
      email: org.billingEmail!,
      planCode: plan.planCode,
      reference,
      callbackUrl: this.callbackUrl(reference),
      metadata: { orgId, planId: plan.id, subscriptionId: current.id },
    });
  }

  /**
   * Pro → Basic (or annual → monthly) at the end of the paid period. Blocked until the org
   * already fits the target plan; numeric limits then drop to the lower plan until it switches.
   */
  async downgrade(
    orgId: string,
    input: ChangePlanDto,
  ): Promise<{ pendingPlanId: string; startsAt: Date }> {
    const current = await this.activeSubscription(orgId);
    const plan = await this.plan(input.planId);

    if (this.planRank(plan) >= this.planRank(current.plan)) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'not_a_downgrade',
        'Choose a plan below your current one; use upgrade for a higher plan',
      );
    }
    if (current.pendingPlanId) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'plan_change_pending',
        'A plan change is already scheduled for this subscription',
      );
    }
    if (!plan.planCode) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'plan_not_available',
        'This plan is not connected to Paystack yet',
      );
    }
    if (
      !current.providerCustomerCode ||
      !current.providerSubscriptionCode ||
      !current.providerEmailToken
    ) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'subscription_not_linked',
        'Paystack has not linked this subscription yet',
      );
    }

    const startsAt = current.nextPaymentDate ?? current.currentPeriodEnd;
    if (!startsAt) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'subscription_not_downgradable',
        'This subscription has no upcoming renewal to switch at',
      );
    }

    await this.assertDowngradeFits(orgId, plan);

    await this.billingClient.disableSubscription(
      current.providerSubscriptionCode,
      current.providerEmailToken,
    );
    await this.billingClient.createSubscription({
      customer: current.providerCustomerCode,
      planCode: plan.planCode,
      authorization: current.authorizationCode,
      startDate: startsAt,
    });

    await this.db.withTenant({ orgId, livemode: true }, (tx) =>
      tx
        .update(subscriptions)
        .set({ pendingPlanId: plan.id, cancelAtPeriodEnd: true })
        .where(eq(subscriptions.id, current.id)),
    );
    await this.clearCaches(orgId);

    return { pendingPlanId: plan.id, startsAt };
  }

  async cancel(orgId: string): Promise<{ cancelAtPeriodEnd: boolean }> {
    const subscription = await this.linkedSubscription(orgId);
    if (
      subscription.status !== 'active' &&
      subscription.status !== 'past_due'
    ) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'subscription_not_active',
        'This subscription is not active',
      );
    }
    if (
      !subscription.providerSubscriptionCode ||
      !subscription.providerEmailToken
    ) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'subscription_not_cancellable',
        'Paystack has not linked this subscription yet',
      );
    }

    await this.billingClient.disableSubscription(
      subscription.providerSubscriptionCode,
      subscription.providerEmailToken,
    );

    await this.db.withTenant({ orgId, livemode: true }, (tx) =>
      tx
        .update(subscriptions)
        .set({ cancelAtPeriodEnd: true })
        .where(eq(subscriptions.id, subscription.id)),
    );
    await this.clearCaches(orgId);

    return { cancelAtPeriodEnd: true };
  }

  async payNow(orgId: string): Promise<CheckoutView> {
    const subscription = await this.linkedSubscription(orgId);
    if (
      subscription.status !== 'past_due' &&
      subscription.status !== 'suspended'
    ) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'subscription_current',
        'This subscription does not need a payment',
      );
    }

    const org = await this.organization(orgId);
    if (!org.billingEmail) {
      throw new CodedException(
        HttpStatus.BAD_REQUEST,
        'billing_email_required',
        'Add a billing email before making paymet',
      );
    }
    if (!subscription.plan.planCode) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'plan_not_available',
        'This plan is not connected to Paystack yet',
      );
    }

    if (
      subscription.providerSubscriptionCode &&
      subscription.providerEmailToken
    ) {
      await this.billingClient.disableSubscription(
        subscription.providerSubscriptionCode,
        subscription.providerEmailToken,
      );
    }

    const reference = `${BILLING_REFERENCE_PREFIX}${randomAlphanumeric(24)}`;
    return this.billingClient.initialize({
      email: org.billingEmail,
      planCode: subscription.plan.planCode,
      reference,
      callbackUrl: this.callbackUrl(reference),
      metadata: {
        orgId,
        planId: subscription.planId,
        subscriptionId: subscription.id,
      },
    });
  }

  async manageLink(orgId: string): Promise<{ link: string }> {
    const subscription = await this.linkedSubscription(orgId);
    return {
      link: await this.billingClient.getManageLink(
        subscription.providerSubscriptionCode!,
      ),
    };
  }

  async sendManageEmail(orgId: string): Promise<void> {
    const subscription = await this.linkedSubscription(orgId);
    await this.billingClient.sendManageEmail(
      subscription.providerSubscriptionCode!,
    );
  }

  private async activeSubscription(
    orgId: string,
  ): Promise<CurrentSubscription> {
    const subscription = await this.subscriptions.getLatest(orgId);
    if (!subscription) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'no_subscription',
        'This organization has no subscription to change',
      );
    }
    if (
      !ACTIVE_SUBSCRIPTION_STATUSES.includes(
        subscription.status as ActiveSubscriptionStatus,
      )
    ) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'subscription_not_active',
        'This subscription is not active',
      );
    }
    return subscription;
  }

  private async ensureBillingEmail(
    orgId: string,
    requested?: string,
  ): Promise<Organization> {
    const org = await this.organization(orgId);
    if (!org.billingEmail) {
      if (!requested) {
        throw new CodedException(
          HttpStatus.BAD_REQUEST,
          'billing_email_required',
          'Add a billing email before changing plans',
        );
      }
      return this.organizations.setBillingEmail(orgId, requested);
    }
    if (requested && requested.toLowerCase() !== org.billingEmail) {
      return this.organizations.setBillingEmail(orgId, requested);
    }
    return org;
  }

  private planRank(plan: Plan): number {
    return PLAN_TIER_RANK[plan.tier] * 10 + PLAN_INTERVAL_RANK[plan.interval];
  }

  private async assertDowngradeFits(
    orgId: string,
    target: Plan,
  ): Promise<void> {
    const [entitlements, counts] = await Promise.all([
      this.entitlements.forPlan(orgId, target.id),
      this.overview.counts(orgId),
    ]);

    const checks: { key: LimitKey; current: number }[] = [
      { key: 'locations.max', current: counts.locations },
      { key: 'screens.max', current: counts.screens },
      {
        key: 'members.max',
        current: counts.staff.members + counts.staff.pendingInvites,
      },
      { key: 'api_keys.live.max', current: counts.liveApiKeys },
      {
        key: 'webhook_endpoints.live.max',
        current: counts.liveWebhookEndpoints,
      },
    ];

    const violations = checks
      .filter(({ key, current }) => current > entitlements[key])
      .map(({ key, current }) => ({
        key,
        limit: entitlements[key],
        current,
      }));

    if (violations.length) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'downgrade_blocked',
        'Remove resources until this organization fits the target plan',
        { violations },
      );
    }
  }

  private async linkedSubscription(
    orgId: string,
  ): Promise<CurrentSubscription> {
    const subscription = await this.subscriptions.getLatest(orgId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    if (!subscription.providerSubscriptionCode) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'subscription_not_linked',
        'Paystack has not linked this subscription yet',
      );
    }
    return subscription;
  }

  private async organization(orgId: string): Promise<Organization> {
    const [org] = await this.db.client
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    return org;
  }

  private async plan(planId: string): Promise<Plan> {
    const [plan] = await this.db.client
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.isActive, true)));
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  private async clearCaches(orgId: string): Promise<void> {
    await Promise.all([
      this.subscriptions.clear(orgId),
      this.entitlements.clear(orgId),
    ]);
  }

  private callbackUrl(reference: string): string {
    const base = Secrets.DASHBOARD_URL.replace(/\/+$/, '');
    return `${base}/billing?reference=${encodeURIComponent(reference)}`;
  }
}
