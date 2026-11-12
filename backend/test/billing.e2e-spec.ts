import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { SubscriptionsService } from '@src/billing/subscriptions.service';
import { BillingWebhooksService } from '@src/billing/billing-webhooks.service';
import { BASIC_ENTITLEMENTS } from '@src/entitlements/entitlements.constants';
import { eventually, useE2eApp } from './utils/e2e-app';

describe('Billing (e2e)', () => {
  const {
    ctx,
    dash,
    api,
    signup,
    verify,
    createApiKey,
    location,
    billingWebhook,
    paystack,
    http,
    seq,
  } = useE2eApp();

  const clearBillingCaches = async (orgId: string) => {
    await ctx.app.get(EntitlementsService).clear(orgId);
    await ctx.app.get(SubscriptionsService).clear(orgId);
  };

  const planId = async (key: string): Promise<string> => {
    const result = await ctx.ownerPool.query<{ id: string }>(
      'select id from plans where key = $1',
      [key],
    );
    return result.rows[0].id;
  };

  const subscribe = async (orgId: string, key = 'pro_monthly') => {
    await ctx.ownerPool.query(
      `insert into subscriptions (organization_id, plan_id, status, started_at)
       values ($1, $2, 'active', now())`,
      [orgId, await planId(key)],
    );
    await clearBillingCaches(orgId);
  };

  const setOverride = (orgId: string, key: string, value: boolean | number) =>
    ctx.ownerPool.query(
      `insert into entitlement_overrides (organization_id, key, value, reason, set_by)
       values ($1, $2, $3::jsonb, 'test', 'e2e')
       on conflict (organization_id, key)
       do update set value = excluded.value`,
      [orgId, key, JSON.stringify(value)],
    );

  const planDetails = async (key = 'pro_monthly') => {
    const result = await ctx.ownerPool.query<{
      id: string;
      plan_code: string;
    }>('select id, plan_code from plans where key = $1', [key]);
    return result.rows[0];
  };

  const billingEmail = () => `billing${seq()}@example.com`;
  const futureDate = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const startCheckout = async (
    session: { accessToken: string },
    key = 'pro_monthly',
    email = billingEmail(),
  ) => {
    const plan = await planDetails(key);
    const res = await dash('post', '/billing/subscribe', session)
      .send({ planId: plan.id, billingEmail: email })
      .expect(201);

    return {
      planId: plan.id,
      planCode: plan.plan_code,
      email,
      reference: res.body.data.reference as string,
      authorizationUrl: res.body.data.authorizationUrl as string,
    };
  };

  const providerDetails = () => {
    const n = seq();
    return {
      subscriptionCode: `sub_${n}`,
      emailToken: `tok_${n}`,
      customerCode: `cus_${n}`,
    };
  };

  const providerPayload = (
    checkout: Awaited<ReturnType<typeof startCheckout>>,
    provider: ReturnType<typeof providerDetails>,
    orgId: string,
  ) => ({
    customer: { email: checkout.email, customer_code: provider.customerCode },
    plan: { plan_code: checkout.planCode },
    subscription_code: provider.subscriptionCode,
    email_token: provider.emailToken,
    metadata: { orgId, planId: checkout.planId },
  });

  const chargeEvent = (
    checkout: Awaited<ReturnType<typeof startCheckout>>,
    provider: ReturnType<typeof providerDetails>,
    orgId: string,
    reference = checkout.reference,
    id = `charge_${seq()}`,
  ) => ({
    event: 'charge.success',
    data: {
      ...providerPayload(checkout, provider, orgId),
      id,
      status: 'success',
      reference,
      amount: 250_000,
      currency: 'NGN',
      paid_at: new Date().toISOString(),
    },
  });

  const subscriptionCreateEvent = (
    checkout: Awaited<ReturnType<typeof startCheckout>>,
    provider: ReturnType<typeof providerDetails>,
    orgId: string,
    nextPaymentDate: Date,
    id = `subevt_${seq()}`,
  ) => ({
    event: 'subscription.create',
    data: {
      ...providerPayload(checkout, provider, orgId),
      id,
      status: 'active',
      created_at: new Date().toISOString(),
      next_payment_date: nextPaymentDate.toISOString(),
    },
  });

  const activate = async (
    session: { accessToken: string; orgId: string },
    key = 'pro_monthly',
    email = billingEmail(),
  ) => {
    const checkout = await startCheckout(session, key, email);
    const provider = providerDetails();
    const nextPaymentDate = futureDate();
    const chargeId = `charge_${seq()}`;

    await billingWebhook(
      chargeEvent(
        checkout,
        provider,
        session.orgId,
        checkout.reference,
        chargeId,
      ),
    ).expect(200);
    await billingWebhook(
      subscriptionCreateEvent(
        checkout,
        provider,
        session.orgId,
        nextPaymentDate,
      ),
    ).expect(200);

    await eventually(async () => {
      const res = await dash('get', '/billing', session).expect(200);
      expect(res.body.data.subscription?.status).toBe('active');
    });

    return { checkout, provider, nextPaymentDate, chargeId };
  };

  const sentTo = (email: string) =>
    ctx.platformMail.mock.calls
      .filter(([to]) => to === email)
      .map(([, sent]) => sent as { subject: string; text: string });

  it('lists public plans and Basic entitlements for an unsubscribed org', async () => {
    const session = await signup();

    const res = await dash('get', '/billing', session).expect(200);

    expect(res.body.data.subscription).toBeNull();
    expect(res.body.data.entitlements).toEqual(BASIC_ENTITLEMENTS);
    expect(
      res.body.data.plans.map((p: { key: string }) => p.key).sort(),
    ).toEqual(['basic_annual', 'basic_monthly', 'pro_annual', 'pro_monthly']);
    expect(res.body.data.usage).toEqual({
      locations: 0,
      screens: 0,
      staff: { members: 1, pendingInvites: 0 },
      liveApiKeys: 0,
      liveWebhookEndpoints: 0,
    });
  });

  it('applies plan and override changes within the 60s cache window', async () => {
    const session = await signup();
    await subscribe(session.orgId);

    let res = await dash('get', '/billing', session).expect(200);
    expect(res.body.data.entitlements['locations.max']).toBe(10);
    expect(res.body.data.subscription.plan.tier).toBe('pro');

    await setOverride(session.orgId, 'locations.max', 12);
    await clearBillingCaches(session.orgId);

    res = await dash('get', '/billing', session).expect(200);
    expect(res.body.data.entitlements['locations.max']).toBe(12);

    await ctx.ownerPool.query(
      `delete from entitlement_overrides where organization_id = $1 and key = 'locations.max'`,
      [session.orgId],
    );
    await clearBillingCaches(session.orgId);

    res = await dash('get', '/billing', session).expect(200);
    expect(res.body.data.entitlements['locations.max']).toBe(10);
  });

  it('enforces the plan rate limit per live API key', async () => {
    const session = await signup();
    await verify(session);
    const key = await createApiKey(session, 'secret', 'live');

    await setOverride(session.orgId, 'api.rate_limit_per_sec', 1);
    await clearBillingCaches(session.orgId);

    await api('get', '/locations', key).expect(200);
    const limited = await api('get', '/locations', key).expect(429);
    expect(limited.body.error.code).toBe('rate_limit_exceeded');

    await ctx.ownerPool.query(
      `delete from entitlement_overrides where organization_id = $1 and key = 'api.rate_limit_per_sec'`,
      [session.orgId],
    );
    await subscribe(session.orgId);

    await api('get', '/locations', key).expect(200);
  });

  it('uses live plan limits for shared resources', async () => {
    const session = await signup();
    await subscribe(session.orgId);
    await setOverride(session.orgId, 'locations.max', 4);
    await clearBillingCaches(session.orgId);

    for (let i = 1; i <= 4; i++) {
      await dash('post', '/locations', session, 'test')
        .send(location(`Location ${i}`))
        .expect(201);
    }

    const limited = await dash('post', '/locations', session, 'test')
      .send(location('Location 5'))
      .expect(403);
    expect(limited.body.error).toMatchObject({
      code: 'plan_limit_reached',
      details: { key: 'locations.max', limit: 4 },
    });
  });

  it('starts Paystack checkout with the billing email and plan metadata', async () => {
    const session = await signup();
    const checkout = await startCheckout(session, 'pro_monthly');

    expect(checkout.planCode).toBeTruthy();
    expect(checkout.authorizationUrl).toContain('checkout.paystack.com');
    const transaction = paystack.transactions.get(checkout.reference)!;
    expect(transaction.email).toBe(checkout.email);
    expect(transaction.plan).toBe(checkout.planCode);
    expect(transaction.metadata).toEqual({
      orgId: session.orgId,
      planId: checkout.planId,
    });

    const overview = await dash('get', '/billing', session).expect(200);
    expect(overview.body.data.billingEmail).toBe(checkout.email);
  });

  it('links the first payment and subscription idempotently', async () => {
    const session = await signup();
    const active = await activate(session);

    let overview = await dash('get', '/billing', session).expect(200);
    expect(overview.body.data.subscription).toMatchObject({
      status: 'active',
      cancelAtPeriodEnd: false,
    });
    expect(overview.body.data.subscription.plan.key).toBe('pro_monthly');
    expect(overview.body.data.entitlements['locations.max']).toBe(10);
    await eventually(async () => {
      expect(
        sentTo(active.checkout.email).some(({ subject }) =>
          subject.includes('subscription is active'),
        ),
      ).toBe(true);
    });

    await billingWebhook(
      chargeEvent(
        active.checkout,
        active.provider,
        session.orgId,
        active.checkout.reference,
        active.chargeId,
      ),
    ).expect(200);
    const [{ count }] = (
      await ctx.ownerPool.query<{ count: string }>(
        'select count(*) from billing_events where provider_event_id = $1',
        [active.chargeId],
      )
    ).rows;
    expect(Number(count)).toBe(1);

    const again = await dash('post', '/billing/subscribe', session)
      .send({ planId: active.checkout.planId })
      .expect(409);
    expect(again.body.error.code).toBe('subscription_exists');

    overview = await dash('get', '/billing', session).expect(200);
    expect(overview.body.data.subscription.status).toBe('active');
  });

  it('updates renewal dates from invoice.create', async () => {
    const session = await signup();
    const active = await activate(session);
    const nextPaymentDate = futureDate();

    await billingWebhook({
      event: 'invoice.create',
      data: {
        ...providerPayload(active.checkout, active.provider, session.orgId),
        id: `invoice_${seq()}`,
        next_payment_date: nextPaymentDate.toISOString(),
      },
    }).expect(200);

    await eventually(async () => {
      const overview = await dash('get', '/billing', session).expect(200);
      expect(overview.body.data.subscription.nextPaymentDate).toBe(
        nextPaymentDate.toISOString(),
      );
    });
    await eventually(async () => {
      expect(
        sentTo(active.checkout.email).some(({ subject }) =>
          subject.includes('Upcoming renewal'),
        ),
      ).toBe(true);
    });
  });

  it('enters a 7-day grace period, suspends, then recovers from invoice.update', async () => {
    const session = await signup();
    const active = await activate(session);
    const provider = providerPayload(
      active.checkout,
      active.provider,
      session.orgId,
    );

    await billingWebhook({
      event: 'invoice.payment_failed',
      data: { ...provider, id: `failed_${seq()}` },
    }).expect(200);

    await eventually(async () => {
      const overview = await dash('get', '/billing', session).expect(200);
      expect(overview.body.data.subscription.status).toBe('past_due');
      expect(overview.body.data.subscription.graceEndsAt).toBeTruthy();
      expect(overview.body.data.entitlements['locations.max']).toBe(10);
    });
    await eventually(async () => {
      expect(
        sentTo(active.checkout.email).some(({ subject }) =>
          subject.includes('Payment failed'),
        ),
      ).toBe(true);
    });

    const failedInvoiceId = `invoice_update_failed_${seq()}`;
    await billingWebhook({
      event: 'invoice.update',
      data: {
        ...provider,
        id: failedInvoiceId,
        status: 'failed',
      },
    }).expect(200);
    await eventually(async () => {
      const result = await ctx.ownerPool.query<{ processed_at: Date | null }>(
        'select processed_at from billing_events where provider_event_id = $1',
        [failedInvoiceId],
      );
      expect(result.rows[0].processed_at).not.toBeNull();
    });
    expect(
      sentTo(active.checkout.email).filter(({ subject }) =>
        subject.includes('Payment failed'),
      ),
    ).toHaveLength(1);

    const overview = await dash('get', '/billing', session).expect(200);
    const subscriptionId = overview.body.data.subscription.id as string;
    await ctx.ownerPool.query(
      `update subscriptions set grace_ends_at = now() - interval '1 second' where id = $1`,
      [subscriptionId],
    );
    await ctx.app
      .get(BillingWebhooksService)
      .suspendIfStillPastDue(session.orgId, subscriptionId);

    await eventually(async () => {
      const suspended = await dash('get', '/billing', session).expect(200);
      expect(suspended.body.data.subscription.status).toBe('suspended');
      expect(suspended.body.data.entitlements).toEqual(BASIC_ENTITLEMENTS);
    });
    await eventually(async () => {
      expect(
        sentTo(active.checkout.email).some(({ subject }) =>
          subject.includes('subscription suspended'),
        ),
      ).toBe(true);
    });

    const nextPaymentDate = futureDate();
    await billingWebhook({
      event: 'invoice.update',
      data: {
        ...provider,
        id: `invoice_update_success_${seq()}`,
        status: 'success',
        paid_at: new Date().toISOString(),
        next_payment_date: nextPaymentDate.toISOString(),
      },
    }).expect(200);

    await eventually(async () => {
      const recovered = await dash('get', '/billing', session).expect(200);
      expect(recovered.body.data.subscription.status).toBe('active');
      expect(recovered.body.data.subscription.graceEndsAt).toBeNull();
      expect(recovered.body.data.entitlements['locations.max']).toBe(10);
      expect(recovered.body.data.subscription.nextPaymentDate).toBe(
        nextPaymentDate.toISOString(),
      );
    });
  });

  it('schedules and completes cancellation from subscription webhooks', async () => {
    const session = await signup();
    const active = await activate(session);
    const provider = providerPayload(
      active.checkout,
      active.provider,
      session.orgId,
    );

    await billingWebhook({
      event: 'subscription.not_renew',
      data: { ...provider, id: `not_renew_${seq()}` },
    }).expect(200);

    await eventually(async () => {
      const overview = await dash('get', '/billing', session).expect(200);
      expect(overview.body.data.subscription.cancelAtPeriodEnd).toBe(true);
    });
    await eventually(async () => {
      expect(
        sentTo(active.checkout.email).some(({ subject }) =>
          subject.includes('subscription will end'),
        ),
      ).toBe(true);
    });

    await billingWebhook({
      event: 'subscription.disable',
      data: { ...provider, id: `disable_${seq()}`, status: 'cancelled' },
    }).expect(200);

    await eventually(async () => {
      const overview = await dash('get', '/billing', session).expect(200);
      expect(overview.body.data.subscription.status).toBe('cancelled');
      expect(overview.body.data.entitlements).toEqual(BASIC_ENTITLEMENTS);
    });
    await eventually(async () => {
      expect(
        sentTo(active.checkout.email).some(({ subject }) =>
          subject.includes('subscription cancelled'),
        ),
      ).toBe(true);
    });
  });

  it('supports manage link, manage email and pay-now', async () => {
    const session = await signup();
    const active = await activate(session);

    const link = await dash('get', '/billing/manage-link', session).expect(200);
    expect(link.body.data.link).toBe(
      `https://paystack.com/manage/${active.provider.subscriptionCode}`,
    );

    await dash('post', '/billing/manage-email', session).expect(200);
    expect(paystack.manageEmails).toContain(active.provider.subscriptionCode);

    const provider = providerPayload(
      active.checkout,
      active.provider,
      session.orgId,
    );
    await billingWebhook({
      event: 'invoice.payment_failed',
      data: { ...provider, id: `failed_${seq()}` },
    }).expect(200);
    await eventually(async () => {
      const overview = await dash('get', '/billing', session).expect(200);
      expect(overview.body.data.subscription.status).toBe('past_due');
    });

    const paid = await dash('post', '/billing/pay-now', session).expect(200);
    expect(paid.body.data.authorizationUrl).toContain('checkout.paystack.com');
    expect(paystack.disabledSubscriptions).toContainEqual({
      code: active.provider.subscriptionCode,
      token: active.provider.emailToken,
    });

    await billingWebhook(
      chargeEvent(
        active.checkout,
        active.provider,
        session.orgId,
        paid.body.data.reference as string,
      ),
    ).expect(200);

    await eventually(async () => {
      const overview = await dash('get', '/billing', session).expect(200);
      expect(overview.body.data.subscription.status).toBe('active');
      expect(overview.body.data.entitlements['locations.max']).toBe(10);
    });
  });

  it('rejects invalid billing webhook signatures and duplicate billing emails', async () => {
    const session = await signup();
    const checkout = await startCheckout(session);

    await http()
      .post('/api/webhooks/billing/paystack')
      .set('content-type', 'application/json')
      .set('x-paystack-signature', 'not-a-signature')
      .send(JSON.stringify({ event: 'charge.success', data: {} }))
      .expect(401);

    const other = await signup();
    const conflict = await dash('patch', '/organization', other)
      .send({ billingEmail: checkout.email })
      .expect(409);
    expect(conflict.body.error.code).toBe('billing_email_taken');
  });
});
