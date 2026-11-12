import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { organizations, plans, subscriptions } from '@src/db/schema';
import type { Organization, Plan } from '@src/db/schema/types';
import { CodedException } from '@src/common/errors';
import { Secrets } from '@src/common/secrets';
import type { CheckoutView, CurrentSubscription } from '@src/common/types';
import { randomAlphanumeric } from '@src/common/util';
import { OrganizationsService } from '@src/organizations/organizations.service';
import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { BILLING_REFERENCE_PREFIX } from './billing.constants';
import { PaystackBillingClient } from './paystack-billing.client';
import { SubscriptionsService } from './subscriptions.service';
import { SubscribeDto } from './dto/billing.dto';

@Injectable()
export class BillingService {
  constructor(
    private readonly db: DbService,
    private readonly billingClient: PaystackBillingClient,
    private readonly subscriptions: SubscriptionsService,
    private readonly entitlements: EntitlementsService,
    private readonly organizations: OrganizationsService,
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
