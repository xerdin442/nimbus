import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { SubscriptionsService } from '@src/billing/subscriptions.service';
import { BASIC_ENTITLEMENTS } from '@src/entitlements/entitlements.constants';
import { useE2eApp } from './utils/e2e-app';

describe('Billing (e2e)', () => {
  const { ctx, dash, api, signup, verify, createApiKey, location } =
    useE2eApp();

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
});
