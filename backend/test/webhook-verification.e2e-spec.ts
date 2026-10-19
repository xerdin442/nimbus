import { eventually, useE2eApp, type Session } from './utils/e2e-app';

/**
 * Phase 3a follow-up: the org's Paystack webhook URL (a dashboard setting Nimbus can't read) is
 * proven with a verification payment. Online payments stay blocked until its `charge.success`
 * arrives on the mode's webhook URL, signed with that mode's key.
 */
describe('Webhook verification (e2e)', () => {
  const {
    ctx,
    paystack,
    seq,
    dash,
    api,
    signup,
    verify,
    connectPaystack,
    verifyWebhook,
    paystackWebhook,
    createApiKey,
  } = useE2eApp();

  const ALREADY_VERIFIED = {
    status: 'already_verified',
    reference: null,
    authorizationUrl: null,
    amount: null,
    currency: null,
  };

  let transactionId = 10_000_000_000;

  /**
   * Delivers a signed `charge.success` for `reference`, as Paystack would. Use the mode's own
   * key for a valid signature, or any other key to test rejection.
   */
  const pay = (
    orgId: string,
    mode: 'test' | 'live',
    secretKey: string,
    reference: string,
    {
      amount = 50_000,
      currency = 'NGN',
    }: { amount?: number; currency?: string } = {},
  ) =>
    paystackWebhook(orgId, mode, secretKey, {
      event: 'charge.success',
      data: {
        id: ++transactionId,
        status: 'success',
        reference,
        amount,
        currency,
        paid_at: new Date().toISOString(),
      },
    });

  const config = (owner: Session, mode: 'test' | 'live' = 'test') =>
    dash('get', '/payment-config', owner, mode).expect(200);

  /** POST the verify endpoint (200); returns its data. */
  const requestVerify = async (
    owner: Session,
    mode: 'test' | 'live' = 'test',
  ) =>
    (
      await dash('post', '/payment-config/webhooks/verify', owner, mode).expect(
        200,
      )
    ).body.data as {
      status: 'started' | 'already_verified';
      reference: string | null;
      authorizationUrl: string | null;
      amount: number | null;
      currency: string | null;
    };

  /** A connected test-mode config and its secret API key. */
  const setup = async () => {
    const owner = await signup();
    const testKey = `sk_test_${seq()}good`;
    await connectPaystack(owner, 'test', testKey);
    const sk = await createApiKey(owner, 'secret', 'test');
    return { owner, testKey, sk };
  };

  describe('gating', () => {
    it('refuses to start online payments before webhook verification', async () => {
      const { owner, sk } = await setup();

      const res = await api('post', '/reservations', sk).send({}).expect(503);
      expect(res.body.error.code).toBe('payment_webhook_not_verified');
      expect((await config(owner)).body.data.isWebhookVerified).toBe(false);
    });

    it('lets online payments start once verification completes', async () => {
      const { owner, testKey, sk } = await setup();
      const started = await requestVerify(owner);
      const transaction = paystack.transactions.get(started.reference!)!;
      await pay(owner.orgId, 'test', testKey, started.reference!, {
        amount: transaction.amount,
        currency: transaction.currency,
      });

      await eventually(async () => {
        expect((await config(owner)).body.data.isWebhookVerified).toBe(true);
      });

      // The guard passes now; the pipeline rejects the (still invalid) body instead.
      await api('post', '/reservations', sk).send({}).expect(400);
    });
  });

  describe('the verification payment', () => {
    it('is a small own-key payment tagged as webhook verification', async () => {
      const { owner, testKey } = await setup();

      const started = await requestVerify(owner);

      expect(started).toMatchObject({
        status: 'started',
        amount: 50_000,
        currency: 'NGN',
        reference: expect.stringMatching(/^nmb-[a-z0-9]{24}$/),
        authorizationUrl: expect.stringContaining(
          'https://checkout.paystack.com/',
        ),
      });
      expect(paystack.transactions.get(started.reference!)).toMatchObject({
        secretKey: testKey,
        email: owner.email,
        amount: 50_000,
        currency: 'NGN',
        callbackUrl: 'http://localhost:5173/settings/payments',
        metadata: {
          purpose: 'webhook_verification',
          orgId: owner.orgId,
          livemode: false,
        },
      });
    });

    it('stays pending, and the config unverified, without the webhook', async () => {
      const { owner } = await setup();
      await requestVerify(owner);

      const pending = await ctx.ownerPool.query<{ status: string }>(
        'select status from payments where method = $1 and organization_id = $2',
        ['verification', owner.orgId],
      );
      expect(pending.rows).toHaveLength(1);
      expect((await config(owner)).body.data.isWebhookVerified).toBe(false);
    });

    it('verifies each mode through its own webhook URL, and only its own', async () => {
      const { owner, testKey } = await setup();
      await verify(owner);
      const liveKey = `sk_live_${seq()}good`;
      await connectPaystack(owner, 'live', liveKey);
      await createApiKey(owner, 'secret', 'live');

      const started = await requestVerify(owner);
      await pay(owner.orgId, 'test', testKey, started.reference!);
      await eventually(async () => {
        expect((await config(owner)).body.data.isWebhookVerified).toBe(true);
      });

      // The test payment delivered on the live URL: valid signature (live key), unknown
      // reference in the live mode → no verification.
      await pay(owner.orgId, 'live', liveKey, started.reference!);
      expect((await config(owner, 'live')).body.data.isWebhookVerified).toBe(
        false,
      );

      const liveStarted = await requestVerify(owner, 'live');
      await pay(owner.orgId, 'live', liveKey, liveStarted.reference!);
      await eventually(async () => {
        expect((await config(owner, 'live')).body.data.isWebhookVerified).toBe(
          true,
        );
      });
    });
  });

  describe('wrong evidence', () => {
    it('rejects a webhook signed with a different key', async () => {
      const { owner } = await setup();
      const started = await requestVerify(owner);

      await pay(
        owner.orgId,
        'test',
        `sk_test_${seq()}bad`,
        started.reference!,
      ).expect(401);
      expect((await config(owner)).body.data.isWebhookVerified).toBe(false);
    });

    it('marks a mismatched verification payment failed without verifying', async () => {
      const { owner, testKey } = await setup();
      const started = await requestVerify(owner);

      await pay(owner.orgId, 'test', testKey, started.reference!, {
        amount: 1,
      });

      await eventually(async () => {
        const row = await ctx.ownerPool.query<{ status: string }>(
          'select status from payments where reference = $1',
          [started.reference],
        );
        expect(row.rows[0].status).toBe('failed');
      });
      expect((await config(owner)).body.data.isWebhookVerified).toBe(false);
    });
  });

  describe('repeats and reconnects', () => {
    it('answers already verified without another payment', async () => {
      const { owner, testKey } = await setup();
      await verifyWebhook(owner, 'test', testKey);

      expect(await requestVerify(owner)).toMatchObject(ALREADY_VERIFIED);
    });

    it('refuses to verify without a connected config', async () => {
      const owner = await signup();
      const res = await dash(
        'post',
        '/payment-config/webhooks/verify',
        owner,
      ).expect(409);
      expect(res.body.error.code).toBe('payment_config_not_verified');
    });

    it('requires a fresh verification after reconnecting the key', async () => {
      const { owner, testKey, sk } = await setup();
      await verifyWebhook(owner, 'test', testKey);

      const newKey = `sk_test_${seq()}good`;
      await connectPaystack(owner, 'test', newKey);
      expect((await config(owner)).body.data.isWebhookVerified).toBe(false);
      const blocked = await api('post', '/reservations', sk).send({});
      expect(blocked).toMatchObject({ status: 503 });

      await verifyWebhook(owner, 'test', newKey);
      expect((await config(owner)).body.data.isWebhookVerified).toBe(true);
    });
  });
});
