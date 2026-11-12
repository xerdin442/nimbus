import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import {
  billingEvents,
  organizations,
  plans,
  subscriptions,
} from '@src/db/schema';
import type {
  BillingEvent,
  NewSubscription,
  Plan,
  Subscription,
  SubscriptionStatus,
} from '@src/db/schema/types';
import { Logger } from '@src/common/logger';
import { Secrets } from '@src/common/secrets';
import type {
  ProcessBillingEventJob,
  SuspendSubscriptionJob,
} from '@src/common/types/job';
import type { OrgContact, RenderedEmail } from '@src/common/types';
import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { PlatformMailService } from '@src/notifications/platform-mail.service';
import {
  cardExpiringEmail,
  paymentFailedEmail,
  renewalReminderEmail,
  subscriptionActiveEmail,
  subscriptionCancellationScheduledEmail,
  subscriptionCancelledEmail,
  subscriptionSuspendedEmail,
} from '@src/notifications/templates';
import { BILLING_GRACE_PERIOD_MS } from './billing.constants';
import type {
  PaystackBillingEvent,
  PaystackBillingEventData,
} from './billing-events';
import { PaystackBillingClient } from './paystack-billing.client';
import { SubscriptionsService } from './subscriptions.service';
import {
  BILLING_QUEUE,
  PROCESS_BILLING_EVENT_JOB,
  SUSPEND_SUBSCRIPTION_JOB,
} from '@src/common/types/constants';
import { isUUID } from 'class-validator';

const toDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const subscriptionCodeOf = (data?: PaystackBillingEventData): string | null =>
  data?.subscription_code ?? data?.subscription?.subscription_code ?? null;

@Injectable()
export class BillingWebhooksService {
  private readonly logger = Logger(BillingWebhooksService.name);

  constructor(
    private readonly db: DbService,
    private readonly client: PaystackBillingClient,
    private readonly subscriptions: SubscriptionsService,
    private readonly entitlements: EntitlementsService,
    private readonly mail: PlatformMailService,
    @InjectQueue(BILLING_QUEUE) private readonly queue: Queue,
  ) {}

  async receive(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    if (
      !rawBody ||
      !signature ||
      !this.client.verifyWebhookSignature(rawBody, signature)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let payload: PaystackBillingEvent;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as PaystackBillingEvent;
    } catch {
      throw new BadRequestException('Invalid webhook payload');
    }

    if (!payload.event) {
      throw new BadRequestException('Missing webhook event type');
    }

    const data = payload.data ?? {};
    const eventId = await this.insertEvent(payload, data, rawBody);
    if (!eventId) return;

    const job: ProcessBillingEventJob = { eventId };
    await this.queue.add(PROCESS_BILLING_EVENT_JOB, job, {
      jobId: `billing-event-${eventId}`,
      attempts: 8,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 1000,
    });
  }

  /** The `process-billing-event` job: applies one stored event, then marks it processed. */
  async process(eventId: string): Promise<void> {
    const [event] = await this.db.client
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.id, eventId));
    if (!event || event.processedAt) return;

    const payload = event.payload as PaystackBillingEvent;
    const data = payload.data ?? {};
    const orgId =
      event.organizationId ??
      (await this.resolveOrganization(data, event.subscriptionCode));

    if (!orgId || !payload.event) {
      this.logger.warn(
        `Skipped billing event ${event.eventType} ${event.providerEventId}: no organization`,
      );
      await this.markProcessed(event, null);
      return;
    }

    await this.dispatch(orgId, payload.event, data);
    await this.markProcessed(event, orgId);
    await Promise.all([
      this.subscriptions.clear(orgId),
      this.entitlements.clear(orgId),
    ]);
  }

  /** Delayed `suspend-subscription` job: suspends only if the sub is still past due. */
  async suspendIfStillPastDue(
    orgId: string,
    subscriptionId: string,
  ): Promise<void> {
    const subscription = await this.db.withTenant(
      { orgId, livemode: true },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.id, subscriptionId),
              eq(subscriptions.organizationId, orgId),
            ),
          );
        return row;
      },
    );

    if (
      !subscription ||
      subscription.status !== 'past_due' ||
      !subscription.graceEndsAt ||
      subscription.graceEndsAt.getTime() > Date.now()
    ) {
      return;
    }

    await this.db.withTenant({ orgId, livemode: true }, (tx) =>
      tx
        .update(subscriptions)
        .set({ status: 'suspended', suspendedAt: new Date() })
        .where(eq(subscriptions.id, subscriptionId)),
    );
    await Promise.all([
      this.subscriptions.clear(orgId),
      this.entitlements.clear(orgId),
    ]);

    const plan = await this.planById(subscription.planId);
    await this.notify(orgId, (org) =>
      subscriptionSuspendedEmail({
        orgName: org.name,
        planName: plan?.name ?? 'Nimbus',
        billingUrl: this.billingUrl(),
      }),
    );
  }

  private async insertEvent(
    payload: PaystackBillingEvent,
    data: PaystackBillingEventData,
    rawBody: Buffer,
  ): Promise<string | null> {
    const orgId = await this.resolveOrganization(data);
    const subscriptionCode = subscriptionCodeOf(data);
    const planCode = data.plan?.plan_code ?? null;
    const providerEventId =
      data.id !== undefined
        ? String(data.id)
        : data.invoice_code
          ? data.invoice_code
          : subscriptionCode
            ? subscriptionCode
            : createHash('sha256').update(rawBody).digest('hex');

    const [inserted] = await this.db.client
      .insert(billingEvents)
      .values({
        organizationId: orgId,
        provider: 'paystack',
        eventType: payload.event!,
        providerEventId,
        subscriptionCode,
        planCode,
        payload,
      })
      .onConflictDoNothing()
      .returning({ id: billingEvents.id });
    if (inserted) return inserted.id;

    const [existing] = await this.db.client
      .select({
        id: billingEvents.id,
        processedAt: billingEvents.processedAt,
      })
      .from(billingEvents)
      .where(
        and(
          eq(billingEvents.provider, 'paystack'),
          eq(billingEvents.eventType, payload.event!),
          eq(billingEvents.providerEventId, providerEventId),
        ),
      );
    return existing && !existing.processedAt ? existing.id : null;
  }

  private async markProcessed(
    event: BillingEvent,
    orgId: string | null,
  ): Promise<void> {
    await this.db.client
      .update(billingEvents)
      .set({
        processedAt: new Date(),
        ...(orgId && !event.organizationId ? { organizationId: orgId } : {}),
      })
      .where(eq(billingEvents.id, event.id));
  }

  private async dispatch(
    orgId: string,
    eventType: string,
    data: PaystackBillingEventData,
  ): Promise<void> {
    switch (eventType) {
      case 'subscription.create':
        await this.onSubscriptionCreate(orgId, data);
        break;
      case 'charge.success':
        await this.onChargeSuccess(orgId, data);
        break;
      case 'invoice.create':
        await this.onInvoiceCreate(orgId, data);
        break;
      case 'invoice.update':
        await this.onInvoiceUpdate(orgId, data);
        break;
      case 'invoice.payment_failed':
        await this.onPaymentFailed(orgId, data);
        break;
      case 'subscription.not_renew':
        await this.onNotRenew(orgId, data);
        break;
      case 'subscription.disable':
        await this.onSubscriptionDisable(orgId, data);
        break;
      case 'subscription.expiring_cards':
        await this.onCardExpiring(orgId);
        break;
      default:
        this.logger.warn(`Unhandled billing event ${eventType}`);
    }
  }

  private async onSubscriptionCreate(
    orgId: string,
    data: PaystackBillingEventData,
  ): Promise<void> {
    const plan = await this.findPlan(data);
    if (!plan) {
      throw new Error(`Billing plan not found for ${subscriptionCodeOf(data)}`);
    }

    const existing = await this.findSubscription(orgId, data);
    const state = this.subscriptionState(
      data.status ?? data.subscription?.status,
    );
    const graceEndsAt =
      state.status === 'past_due'
        ? new Date(Date.now() + BILLING_GRACE_PERIOD_MS)
        : null;
    const nextPaymentDate =
      toDate(data.next_payment_date ?? data.subscription?.next_payment_date) ??
      existing?.nextPaymentDate ??
      null;
    const values: Partial<NewSubscription> = {
      providerCustomerCode:
        data.customer?.customer_code ?? existing?.providerCustomerCode ?? null,
      providerSubscriptionCode:
        subscriptionCodeOf(data) ?? existing?.providerSubscriptionCode ?? null,
      providerEmailToken:
        data.email_token ??
        data.subscription?.email_token ??
        existing?.providerEmailToken ??
        null,
      currentPeriodStart:
        toDate(data.created_at) ??
        existing?.currentPeriodStart ??
        existing?.startedAt ??
        new Date(),
      currentPeriodEnd: nextPaymentDate,
      nextPaymentDate,
      graceEndsAt,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      ...(state.status === 'active' ? { suspendedAt: null } : {}),
      ...(state.status === 'cancelled' ? { cancelledAt: new Date() } : {}),
    };

    if (existing) {
      await this.db.withTenant({ orgId, livemode: true }, (tx) =>
        tx
          .update(subscriptions)
          .set({ ...values, planId: plan.id, status: state.status })
          .where(eq(subscriptions.id, existing.id)),
      );
      if (state.status === 'past_due') {
        await this.scheduleSuspension(orgId, {
          ...existing,
          graceEndsAt,
        });
      }
      return;
    }

    const insert: NewSubscription = {
      organizationId: orgId,
      planId: plan.id,
      status: state.status,
      startedAt: toDate(data.created_at) ?? new Date(),
      ...values,
    };
    const [created] = await this.db.withTenant(
      { orgId, livemode: true },
      (tx) => tx.insert(subscriptions).values(insert).returning(),
    );

    if (state.status === 'past_due') {
      await this.scheduleSuspension(orgId, created);
    }
  }

  private async onChargeSuccess(
    orgId: string,
    data: PaystackBillingEventData,
  ): Promise<void> {
    const existing = await this.findSubscription(orgId, data);
    const plan =
      (await this.findPlan(data)) ??
      (existing ? await this.planById(existing.planId) : null);
    if (!existing && !plan) {
      throw new Error(`Billing plan not found for charge ${data.reference}`);
    }

    const paidAt = toDate(data.paid_at) ?? new Date();
    const nextPaymentDate =
      toDate(data.next_payment_date ?? data.subscription?.next_payment_date) ??
      existing?.nextPaymentDate ??
      null;
    const values: Partial<NewSubscription> = {
      providerCustomerCode:
        data.customer?.customer_code ?? existing?.providerCustomerCode ?? null,
      providerSubscriptionCode:
        subscriptionCodeOf(data) ?? existing?.providerSubscriptionCode ?? null,
      providerEmailToken:
        data.email_token ??
        data.subscription?.email_token ??
        existing?.providerEmailToken ??
        null,
      currentPeriodStart: paidAt,
      currentPeriodEnd: nextPaymentDate ?? existing?.currentPeriodEnd ?? null,
      nextPaymentDate,
      graceEndsAt: null,
      suspendedAt: null,
      cancelledAt: null,
      cancelAtPeriodEnd:
        data.subscription?.status === 'non-renewing'
          ? true
          : (existing?.cancelAtPeriodEnd ?? false),
    };

    if (existing) {
      await this.db.withTenant({ orgId, livemode: true }, (tx) =>
        tx
          .update(subscriptions)
          .set({
            ...values,
            planId: plan?.id ?? existing.planId,
            status: 'active',
          })
          .where(eq(subscriptions.id, existing.id)),
      );
    } else {
      const insert: NewSubscription = {
        organizationId: orgId,
        planId: plan!.id,
        status: 'active',
        startedAt: paidAt,
        ...values,
      };
      await this.db.withTenant({ orgId, livemode: true }, (tx) =>
        tx.insert(subscriptions).values(insert),
      );
    }

    await this.notify(orgId, (org) =>
      subscriptionActiveEmail({
        orgName: org.name,
        planName: plan?.name ?? 'Nimbus',
        nextPaymentDate,
      }),
    );
  }

  private async onInvoiceCreate(
    orgId: string,
    data: PaystackBillingEventData,
  ): Promise<void> {
    const existing = await this.findSubscription(orgId, data);
    if (!existing) return;

    const nextPaymentDate = toDate(
      data.next_payment_date ?? data.subscription?.next_payment_date,
    );
    if (!nextPaymentDate) return;

    await this.db.withTenant({ orgId, livemode: true }, (tx) =>
      tx
        .update(subscriptions)
        .set({ nextPaymentDate, currentPeriodEnd: nextPaymentDate })
        .where(eq(subscriptions.id, existing.id)),
    );

    if (existing.status === 'active') {
      const plan = await this.planById(existing.planId);
      await this.notify(orgId, (org) =>
        renewalReminderEmail({
          orgName: org.name,
          planName: plan?.name ?? 'Nimbus',
          nextPaymentDate,
        }),
      );
    }
  }

  private async onInvoiceUpdate(
    orgId: string,
    data: PaystackBillingEventData,
  ): Promise<void> {
    if (data.status === 'success') {
      await this.onChargeSuccess(orgId, data);
    } else if (data.status === 'failed') {
      await this.onPaymentFailed(orgId, data);
    }
  }

  private async onPaymentFailed(
    orgId: string,
    data: PaystackBillingEventData,
  ): Promise<void> {
    const existing = await this.findSubscription(orgId, data);
    if (!existing || existing.status === 'cancelled') return;

    const wasPastDue = existing.status === 'past_due';
    const graceEndsAt =
      existing.graceEndsAt ?? new Date(Date.now() + BILLING_GRACE_PERIOD_MS);

    await this.db.withTenant({ orgId, livemode: true }, (tx) =>
      tx
        .update(subscriptions)
        .set({ status: 'past_due', graceEndsAt })
        .where(eq(subscriptions.id, existing.id)),
    );
    await this.scheduleSuspension(orgId, {
      ...existing,
      graceEndsAt,
    });

    if (!wasPastDue) {
      await this.notify(orgId, (org) =>
        paymentFailedEmail({
          orgName: org.name,
          graceEndsAt,
          billingUrl: this.billingUrl(),
        }),
      );
    }
  }

  private async onNotRenew(
    orgId: string,
    data: PaystackBillingEventData,
  ): Promise<void> {
    const existing = await this.findSubscription(orgId, data);
    if (!existing || existing.status === 'cancelled') return;

    await this.db.withTenant({ orgId, livemode: true }, (tx) =>
      tx
        .update(subscriptions)
        .set({ cancelAtPeriodEnd: true })
        .where(eq(subscriptions.id, existing.id)),
    );

    const plan = await this.planById(existing.planId);
    await this.notify(orgId, (org) =>
      subscriptionCancellationScheduledEmail({
        orgName: org.name,
        planName: plan?.name ?? 'Nimbus',
        accessUntil:
          existing.currentPeriodEnd ?? existing.nextPaymentDate ?? new Date(),
      }),
    );
  }

  private async onSubscriptionDisable(
    orgId: string,
    data: PaystackBillingEventData,
  ): Promise<void> {
    const existing = await this.findSubscription(orgId, data);
    if (!existing) return;

    await this.db.withTenant({ orgId, livemode: true }, (tx) =>
      tx
        .update(subscriptions)
        .set({
          status: 'cancelled',
          cancelAtPeriodEnd: false,
          cancelledAt: new Date(),
          graceEndsAt: null,
        })
        .where(eq(subscriptions.id, existing.id)),
    );

    const plan = await this.planById(existing.planId);
    await this.notify(orgId, (org) =>
      subscriptionCancelledEmail({
        orgName: org.name,
        planName: plan?.name ?? 'Nimbus',
      }),
    );
  }

  private async onCardExpiring(orgId: string): Promise<void> {
    await this.notify(orgId, (org) =>
      cardExpiringEmail({
        orgName: org.name,
        billingUrl: this.billingUrl(),
      }),
    );
  }

  private async scheduleSuspension(
    orgId: string,
    subscription: Pick<Subscription, 'id' | 'graceEndsAt'>,
  ): Promise<void> {
    const graceEndsAt = subscription.graceEndsAt;
    if (!graceEndsAt) return;

    const job: SuspendSubscriptionJob = {
      orgId,
      subscriptionId: subscription.id,
    };
    await this.queue.add(SUSPEND_SUBSCRIPTION_JOB, job, {
      jobId: `suspend-${subscription.id}-${graceEndsAt.getTime()}`,
      delay: Math.max(0, graceEndsAt.getTime() - Date.now()),
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 1000,
    });
  }

  private async findSubscription(
    orgId: string,
    data: PaystackBillingEventData,
  ): Promise<Subscription | null> {
    const subscriptionCode = subscriptionCodeOf(data);
    const customerCode = data.customer?.customer_code ?? null;

    return this.db.withTenant({ orgId, livemode: true }, async (tx) => {
      if (subscriptionCode) {
        const [byCode] = await tx
          .select()
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.organizationId, orgId),
              eq(subscriptions.providerSubscriptionCode, subscriptionCode),
            ),
          );
        if (byCode) return byCode;
      }

      if (customerCode) {
        const [byCustomer] = await tx
          .select()
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.organizationId, orgId),
              eq(subscriptions.providerCustomerCode, customerCode),
            ),
          )
          .orderBy(desc(subscriptions.startedAt))
          .limit(1);
        if (byCustomer) return byCustomer;
      }

      return null;
    });
  }

  private async findPlan(data: PaystackBillingEventData): Promise<Plan | null> {
    const planId = data.metadata?.planId;
    if (planId && isUUID(planId, 'all')) {
      const plan = await this.planById(planId);
      if (plan) return plan;
    }

    const planCode = data.plan?.plan_code;
    if (!planCode) return null;

    const [plan] = await this.db.client
      .select()
      .from(plans)
      .where(eq(plans.planCode, planCode));
    return plan ?? null;
  }

  private async planById(planId: string): Promise<Plan | null> {
    const [plan] = await this.db.client
      .select()
      .from(plans)
      .where(eq(plans.id, planId));
    return plan ?? null;
  }

  private async resolveOrganization(
    data: PaystackBillingEventData,
    fallbackCode?: string | null,
  ): Promise<string | null> {
    const metadataOrgId = data.metadata?.orgId;
    if (metadataOrgId && isUUID(metadataOrgId, 'all')) {
      const [org] = await this.db.client
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, metadataOrgId));
      if (org) return org.id;
    }

    const email = data.customer?.email?.toLowerCase();
    if (email) {
      const [org] = await this.db.client
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.billingEmail, email));
      if (org) return org.id;
    }

    const subscriptionCode = subscriptionCodeOf(data) ?? fallbackCode;
    if (subscriptionCode) {
      const [event] = await this.db.client
        .select({ organizationId: billingEvents.organizationId })
        .from(billingEvents)
        .where(
          and(
            eq(billingEvents.subscriptionCode, subscriptionCode),
            isNotNull(billingEvents.organizationId),
          ),
        )
        .orderBy(desc(billingEvents.createdAt))
        .limit(1);
      if (event?.organizationId) return event.organizationId;
    }

    return null;
  }

  private subscriptionState(status?: string): {
    status: SubscriptionStatus;
    cancelAtPeriodEnd: boolean;
  } {
    switch (status) {
      case 'non-renewing':
        return { status: 'active', cancelAtPeriodEnd: true };
      case 'attention':
        return { status: 'past_due', cancelAtPeriodEnd: false };
      case 'cancelled':
      case 'completed':
        return { status: 'cancelled', cancelAtPeriodEnd: false };
      default:
        return { status: 'active', cancelAtPeriodEnd: false };
    }
  }

  private async notify(
    orgId: string,
    build: (org: OrgContact) => RenderedEmail,
  ): Promise<void> {
    const [org] = await this.db.client
      .select({
        id: organizations.id,
        name: organizations.name,
        billingEmail: organizations.billingEmail,
        notificationEmail: organizations.notificationEmail,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!org) return;

    try {
      await this.mail.send(
        org.billingEmail ?? org.notificationEmail,
        build(org),
      );
    } catch (error) {
      this.logger.error(
        `Billing email to org ${orgId} failed: ${String(error)}`,
      );
    }
  }

  private billingUrl(): string {
    return `${Secrets.DASHBOARD_URL.replace(/\/+$/, '')}/billing`;
  }
}
