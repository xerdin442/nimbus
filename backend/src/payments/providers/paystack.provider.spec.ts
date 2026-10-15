import { createHmac } from 'crypto';
import { PaystackProvider, toRefundStatus } from './paystack.provider';
import { PaymentProviderError } from './payment-provider.interface';

const respond = (status: number, body: unknown) =>
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    }),
  );

const failureKind = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) =>
      error instanceof PaymentProviderError ? error.kind : 'unclassified',
  );

describe('PaystackProvider', () => {
  const provider = new PaystackProvider();
  const key = 'sk_test_abc';

  afterEach(() => jest.restoreAllMocks());

  it('initializes with our reference, amount in minor units and stringified metadata', async () => {
    const fetchMock = respond(200, {
      status: true,
      data: {
        authorization_url: 'https://checkout.paystack.com/x',
        access_code: 'x',
        reference: 'nmb-1',
      },
    });

    await expect(
      provider.initialize(key, {
        email: 'ada@example.com',
        amount: 300000,
        currency: 'NGN',
        reference: 'nmb-1',
        callbackUrl: 'https://filmhouse.test/paid',
        metadata: { reservationId: 'r1' },
      }),
    ).resolves.toEqual({
      authorizationUrl: 'https://checkout.paystack.com/x',
      reference: 'nmb-1',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect((init!.headers as Record<string, string>).authorization).toBe(
      `Bearer ${key}`,
    );
    expect(JSON.parse(init!.body as string)).toEqual({
      email: 'ada@example.com',
      amount: 300000,
      currency: 'NGN',
      reference: 'nmb-1',
      callback_url: 'https://filmhouse.test/paid',
      metadata: '{"reservationId":"r1"}',
    });
  });

  it('keeps 64-bit transaction ids as strings on verify', async () => {
    respond(200, {
      status: true,
      data: {
        id: 4099260516,
        status: 'success',
        reference: 'nmb-1',
        amount: 300000,
        currency: 'NGN',
        paid_at: '2026-10-12T10:00:00.000Z',
      },
    });

    await expect(provider.verify(key, 'nmb-1')).resolves.toEqual({
      status: 'success',
      transactionId: '4099260516',
      reference: 'nmb-1',
      amount: 300000,
      currency: 'NGN',
      paidAt: new Date('2026-10-12T10:00:00.000Z'),
    });
  });

  it('refunds by reference and maps the status', async () => {
    const fetchMock = respond(200, {
      status: true,
      data: { id: 3018284, status: 'pending' },
    });

    await expect(provider.refund(key, 'nmb-1')).resolves.toEqual({
      refundId: '3018284',
      status: 'pending',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      transaction: 'nmb-1',
    });
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [400, 'rejected'],
    [404, 'rejected'],
    [429, 'unavailable'],
    [502, 'unavailable'],
  ])('classifies HTTP %i as %s', async (status, kind) => {
    respond(status, { status: false, message: 'nope' });

    await expect(failureKind(provider.verify(key, 'nmb-1'))).resolves.toBe(
      kind,
    );
  });

  it('classifies a 200 with status: false as rejected, and a network error as unavailable', async () => {
    respond(200, { status: false, message: 'Transaction not found' });
    await expect(failureKind(provider.verify(key, 'x'))).resolves.toBe(
      'rejected',
    );

    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(failureKind(provider.verify(key, 'x'))).resolves.toBe(
      'unavailable',
    );
  });

  describe('verifyWebhookSignature', () => {
    const body = Buffer.from('{"event":"charge.success","data":{"id":1}}');
    const sign = (secret: string, payload: Buffer) =>
      createHmac('sha512', secret).update(payload).digest('hex');

    it('accepts the HMAC-SHA512 of the raw body with the secret key', () => {
      expect(provider.verifyWebhookSignature(key, body, sign(key, body))).toBe(
        true,
      );
    });

    it('rejects another key, an edited body, or garbage', () => {
      expect(
        provider.verifyWebhookSignature(key, body, sign('sk_test_other', body)),
      ).toBe(false);
      expect(
        provider.verifyWebhookSignature(
          key,
          Buffer.from(body.toString().replace('1', '2')),
          sign(key, body),
        ),
      ).toBe(false);
      expect(provider.verifyWebhookSignature(key, body, 'not-hex')).toBe(false);
    });
  });
});

describe('toRefundStatus', () => {
  it.each([
    ['pending', 'pending'],
    ['processing', 'processing'],
    ['needs-attention', 'needs_attention'],
    ['processed', 'processed'],
    ['failed', 'failed'],
    ['something-new', 'pending'],
  ])('%s → %s', (input, expected) => {
    expect(toRefundStatus(input)).toBe(expected);
  });
});
