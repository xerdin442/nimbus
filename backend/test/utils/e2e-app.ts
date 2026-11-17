import { createHmac } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Pool } from 'pg';
import { AppModule } from '@src/app.module';
import { configureApp } from '@src/app.setup';
import { SubscriptionsService } from '@src/billing/subscriptions.service';
import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { CloudinaryService } from '@src/common/uploads/cloudinary.service';
import { PlatformMailService } from '@src/notifications/platform-mail.service';
import { createOwnerPool, resetTestDatabase } from './test-db';

export type Mode = 'test' | 'live';

export interface Session {
  accessToken: string;
  refreshToken: string;
  orgId: string;
  email: string;
  userId?: string;
}

export interface InviteOptions {
  role?: 'manager' | 'staff';
  locationIds?: string[];
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export interface FakeTransaction {
  secretKey: string;
  email: string;
  amount: number;
  currency: string;
  plan?: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}

/**
 * The fake Paystack's state, per suite. Keys ending in "good" are accepted until revoked;
 * verify reports `verifyStatus` for a reference (default `abandoned`: never paid).
 */
export interface FakePaystack {
  transactions: Map<string, FakeTransaction>;
  verifyStatus: Map<string, string>;
  refunds: { secretKey: string; reference: string }[];
  disabledSubscriptions: { code: string; token: string }[];
  manageEmails: string[];
  scheduledSubscriptions: {
    customer: string;
    plan: string;
    authorization?: string;
    startDate?: string;
  }[];
  revokedKeys: Set<string>;
  /** Next refund call answers with this HTTP status instead of succeeding. */
  failNextRefund?: number;
}

const paystackResponse = (
  paystack: FakePaystack,
  url: URL,
  method: string,
  secretKey: string,
  body: Record<string, unknown>,
) => {
  if (!secretKey.endsWith('good') || paystack.revokedKeys.has(secretKey)) {
    return json(401, { status: false, message: 'Invalid key' });
  }

  if (method === 'POST' && url.pathname === '/transaction/initialize') {
    const reference = body.reference as string;
    paystack.transactions.set(reference, {
      secretKey,
      email: body.email as string,
      amount: body.amount as number,
      currency: body.currency as string,
      plan: body.plan as string | undefined,
      callbackUrl: body.callback_url as string,
      metadata: JSON.parse(body.metadata as string) as Record<string, unknown>,
    });
    return json(200, {
      status: true,
      data: {
        authorization_url: `https://checkout.paystack.com/${reference}`,
        access_code: reference,
        reference,
      },
    });
  }

  if (method === 'POST' && url.pathname === '/subscription/disable') {
    paystack.disabledSubscriptions.push({
      code: body.code as string,
      token: body.token as string,
    });
    return json(200, { status: true, data: { status: 'success' } });
  }

  const manage = /^\/subscription\/([^/]+)\/manage\/(link|email)$/.exec(
    url.pathname,
  );
  if (manage) {
    const code = decodeURIComponent(manage[1]);
    if (manage[2] === 'email') {
      paystack.manageEmails.push(code);
      return json(200, { status: true, data: {} });
    }
    return json(200, {
      status: true,
      data: { link: `https://paystack.com/manage/${code}` },
    });
  }

  if (method === 'POST' && url.pathname === '/subscription') {
    paystack.scheduledSubscriptions.push({
      customer: body.customer as string,
      plan: body.plan as string,
      authorization: body.authorization as string | undefined,
      startDate: body.start_date as string | undefined,
    });
    return json(200, {
      status: true,
      data: {
        subscription_code: `sub_scheduled_${String(body.plan)}`,
        status: 'active',
      },
    });
  }

  const plan = /^\/plan\/(.+)$/.exec(url.pathname);
  if (method === 'GET' && plan) {
    const planCode = decodeURIComponent(plan[1]);
    return json(200, {
      status: true,
      data: {
        name: planCode.replace(/_/g, ' '),
        plan_code: planCode,
        amount: 250_000,
        interval: planCode.includes('annual') ? 'annually' : 'monthly',
        currency: 'NGN',
      },
    });
  }

  const verify = /^\/transaction\/verify\/(.+)$/.exec(url.pathname);
  if (verify) {
    const reference = decodeURIComponent(verify[1]);
    const transaction = paystack.transactions.get(reference);
    if (!transaction) {
      return json(400, {
        status: false,
        message: 'Transaction reference not found',
      });
    }
    return json(200, {
      status: true,
      data: {
        id: 4_000_000_000 + paystack.transactions.size,
        status: paystack.verifyStatus.get(reference) ?? 'abandoned',
        reference,
        amount: transaction.amount,
        currency: transaction.currency,
        paid_at: new Date().toISOString(),
      },
    });
  }

  if (method === 'POST' && url.pathname === '/refund') {
    if (paystack.failNextRefund) {
      const status = paystack.failNextRefund;
      paystack.failNextRefund = undefined;
      return json(status, { status: false, message: 'Refund failed' });
    }
    paystack.refunds.push({ secretKey, reference: body.transaction as string });
    return json(200, {
      status: true,
      data: { id: 3_000_000 + paystack.refunds.length, status: 'pending' },
    });
  }

  return json(200, { status: true, data: [] });
};

/** Fake outbound HTTP: Paystack (see FakePaystack) and Brevo, which accepts any key but "bad". */
const fakeFetch =
  (
    realFetch: typeof fetch,
    paystack: FakePaystack,
    brevoSends: { apiKey: string; body: Record<string, unknown> }[],
  ) =>
  async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers);

    if (url.startsWith('https://api.paystack.co/')) {
      return paystackResponse(
        paystack,
        new URL(url),
        init?.method ?? 'GET',
        headers.get('authorization')?.replace('Bearer ', '') ?? '',
        init?.body
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : {},
      );
    }
    if (url.startsWith('https://api.brevo.com/')) {
      const apiKey = headers.get('api-key') ?? '';
      const body = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : {};
      // Recipients containing "invalid" are refused, to exercise send failures.
      const to = (body.to as { email: string }[] | undefined)?.[0]?.email;
      if (apiKey !== 'bad' && to?.includes('invalid')) {
        return json(400, { message: 'Invalid recipient' });
      }
      if (apiKey !== 'bad') {
        brevoSends.push({ apiKey, body });
      }
      return headers.get('api-key') === 'bad'
        ? json(401, { message: 'Key not found' })
        : json(201, { messageId: '<msg@brevo>' });
    }
    if (url.startsWith('https://api.themoviedb.org/3/')) {
      const parsed = new URL(url);
      if (parsed.pathname === '/3/search/movie') {
        return json(200, {
          results: [
            {
              id: 550,
              title: 'Fight Club',
              release_date: '1999-10-15',
              overview: 'An insomniac office worker...',
              poster_path: '/fight-club.jpg',
            },
            {
              id: 551,
              title: 'Fight Club 2',
              release_date: '2001-01-01',
              overview: null,
              poster_path: null,
            },
          ],
        });
      }
      const movie = /^\/3\/movie\/(\d+)$/.exec(parsed.pathname);
      if (movie) {
        const id = Number(movie[1]);
        return json(200, {
          id,
          title: id === 550 ? 'Fight Club' : `TMDB Movie ${id}`,
          overview: 'An insomniac office worker and a soap salesman...',
          runtime: 139,
          original_language: 'en',
          genres: [{ name: 'Drama' }, { name: 'Thriller' }],
          poster_path: '/fight-club.jpg',
          videos: {
            results: [{ site: 'YouTube', type: 'Trailer', key: 'dQw4w9WgXcQ' }],
          },
        });
      }
      return json(404, { status_code: 34, status_message: 'Not found' });
    }
    return realFetch(input, init);
  };

/** Retries `assertion` until it passes, for effects of background jobs. */
export async function eventually(
  assertion: () => Promise<void>,
  timeoutMs = 10_000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

/**
 * The real app against the test database and Redis, for one e2e suite. Call it at the top of the
 * suite's `describe`: it registers the jest hooks and returns request helpers. Only the outside world
 * is faked: fetch to Paystack / Brevo is stubbed, and platform emails go to the log driver (captured).
 */
export function useE2eApp() {
  const realFetch = globalThis.fetch;
  const fetchMock = jest.spyOn(globalThis, 'fetch');
  const paystack: FakePaystack = {
    transactions: new Map(),
    verifyStatus: new Map(),
    refunds: [],
    disabledSubscriptions: [],
    manageEmails: [],
    scheduledSubscriptions: [],
    revokedKeys: new Set(),
  };
  /** Every successful Brevo send (connection tests and org emails), in request order. */
  const brevoSends: { apiKey: string; body: Record<string, unknown> }[] = [];
  /** Cloudinary calls made through the real service, recorded by the spy installed in beforeAll. */
  const cloudinary: {
    uploads: {
      folder: string;
      name: string;
      publicId: string;
      url: string;
      size: number;
    }[];
    deleted: string[];
  } = { uploads: [], deleted: [] };
  let uploadedAssets = 0;
  const fake = fakeFetch(realFetch, paystack, brevoSends);

  /** Set in `beforeAll`; read them inside tests and hooks only. */
  const ctx = {} as {
    app: INestApplication<App>;
    ownerPool: Pool;
    platformMail: jest.SpyInstance;
  };
  let counter = 0;

  beforeAll(async () => {
    // Before nested describes' beforeAll hooks, which run ahead of any beforeEach.
    fetchMock.mockImplementation(fake);

    ctx.ownerPool = createOwnerPool();
    await resetTestDatabase(ctx.ownerPool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    ctx.app = configureApp(
      // As in main.ts: webhook signatures are checked against the raw body.
      moduleRef.createNestApplication<INestApplication<App>>({ rawBody: true }),
    );
    // Bind the server here: a listening server lets supertest skip its own
    // start/close bookkeeping, which closes the server between requests and
    // races the next one into `TypeError: null (reading 'address')`.
    await ctx.app.listen(0, '127.0.0.1');

    ctx.platformMail = jest.spyOn(ctx.app.get(PlatformMailService), 'send');

    const uploads = ctx.app.get(CloudinaryService);
    jest
      .spyOn(uploads, 'uploadImage')
      .mockImplementation(async (buffer, input) => {
        const publicId = `${input.folder}/${input.name}-${++uploadedAssets}`;
        const url = `https://res.cloudinary.com/nimbus-test/image/upload/${publicId}.png`;
        cloudinary.uploads.push({
          folder: input.folder,
          name: input.name,
          publicId,
          url,
          size: buffer.length,
        });
        return { url, publicId };
      });
    jest.spyOn(uploads, 'destroy').mockImplementation(async (publicId) => {
      cloudinary.deleted.push(publicId);
    });
  });

  // jest's resetMocks clears the implementation before every test.
  beforeEach(() => {
    fetchMock.mockImplementation(fake);
  });

  afterAll(async () => {
    fetchMock.mockRestore();
    await ctx.app?.close();
    await ctx.ownerPool?.end();
  });

  const http = () => request(ctx.app.getHttpServer());

  /** A number unique within the suite, for emails and names. */
  const seq = () => ++counter;

  /**
   * Dashboard request as `session`, in `mode` (default: header omitted = live). No org header:
   * a user belongs to one org, resolved from the session.
   */
  const dash = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    session: Pick<Session, 'accessToken'>,
    mode?: Mode,
  ) => {
    const req = http()
      [method](`/api/dashboard${path}`)
      .set('authorization', `Bearer ${session.accessToken}`);
    return mode ? req.set('x-nimbus-mode', mode) : req;
  };

  /** Public API request with an API key. */
  const api = (method: 'get' | 'post', path: string, key: string) =>
    http()[method](`/api/v1${path}`).set('authorization', `Bearer ${key}`);

  const signup = async (orgName = 'Filmhouse'): Promise<Session> => {
    const email = `owner${seq()}@example.com`;
    const res = await http()
      .post('/api/auth/signup')
      .send({
        name: 'Ada Owner',
        email,
        password: 'correct-horse-battery',
        organization: { name: orgName, country: 'NG', currency: 'NGN' },
      })
      .expect(201);

    return {
      accessToken: res.body.data.tokens.accessToken,
      refreshToken: res.body.data.tokens.refreshToken,
      orgId: res.body.data.organization.id,
      email,
    };
  };

  /** `inviter` invites `email` (default: staff, all locations); returns the emailed token. */
  const inviteToken = async (
    inviter: Session,
    email: string,
    { role = 'staff', locationIds }: InviteOptions = {},
  ) => {
    ctx.platformMail.mockClear();
    await dash('post', '/members/invitations', inviter)
      .send({ email, role, locationIds })
      .expect(201);
    const [, sent] = ctx.platformMail.mock.calls[0] as [
      string,
      { text: string },
    ];
    return /token=([\w-]+)/.exec(sent.text)![1];
  };

  /** A new user who accepted `inviter`'s invite. */
  const joinAs = async (
    inviter: Session,
    email: string,
    options: InviteOptions = {},
  ): Promise<Session> => {
    const token = await inviteToken(inviter, email, options);
    const accepted = await http()
      .post('/api/auth/invitations/accept')
      .send({ token, name: 'Sam Member', password: 'member-password-1' })
      .expect(200);

    return {
      ...inviter,
      email,
      accessToken: accepted.body.data.tokens.accessToken as string,
      refreshToken: accepted.body.data.tokens.refreshToken as string,
      userId: accepted.body.data.user.id as string,
    };
  };

  /** Connects the live Paystack key and an email provider: the org becomes verified. */
  const verify = async (session: Session) => {
    await dash('put', '/emails/config', session)
      .send({
        provider: 'brevo',
        apiKey: 'xkeysib-good',
        fromEmail: 'tickets@filmhouse.test',
        fromName: 'Filmhouse',
      })
      .expect(200);
    await dash('put', '/payments/config', session, 'live')
      .send({ secretKey: 'sk_live_good' })
      .expect(200);
  };

  /** Connects a Paystack key for `mode` (keys ending in "good" pass the connection test). */
  const connectPaystack = (session: Session, mode: Mode, secretKey: string) =>
    dash('put', '/payments/config', session, mode)
      .send({ secretKey })
      .expect(200);

  /**
   * Runs the webhook-verification flow for `mode`: pays the verification payment the verify
   * endpoint starts and delivers its signed `charge.success` webhook, so the org's config ends
   * webhook-verified (skipped when it already is: `started` is `already_verified` then).
   */
  const verifyWebhook = async (
    session: Session,
    mode: Mode,
    secretKey: string,
  ) => {
    const { data } = (
      await dash(
        'post',
        '/payments/config/webhooks/verify',
        session,
        mode,
      ).expect(200)
    ).body as { data: { status: string; reference: string | null } };

    if (!data.reference) return;

    const transaction = paystack.transactions.get(data.reference)!;
    await paystackWebhook(session.orgId, mode, secretKey, {
      event: 'charge.success',
      data: {
        id: 9_000_000_000 + paystack.transactions.size,
        status: 'success',
        reference: data.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        paid_at: new Date().toISOString(),
      },
    }).expect(200);

    await eventually(async () => {
      const config = await dash(
        'get',
        '/payments/config',
        session,
        mode,
      ).expect(200);
      expect(config.body.data.isWebhookVerified).toBe(true);
    });
  };

  /** POST a Paystack webhook signed with `secretKey`, as Paystack would. */
  const paystackWebhook = (
    orgId: string,
    mode: Mode,
    secretKey: string,
    payload: Record<string, unknown>,
  ) => {
    const body = JSON.stringify(payload);
    return http()
      .post(`/api/webhooks/paystack/${orgId}/${mode}`)
      .set('content-type', 'application/json')
      .set(
        'x-paystack-signature',
        createHmac('sha512', secretKey).update(body).digest('hex'),
      )
      .send(body);
  };

  /** POST a platform billing webhook signed with the billing account's secret. */
  const billingWebhook = (payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    return http()
      .post('/api/webhooks/billing/paystack')
      .set('content-type', 'application/json')
      .set(
        'x-paystack-signature',
        createHmac('sha512', process.env.PAYSTACK_BILLING_SECRET_KEY!)
          .update(body)
          .digest('hex'),
      )
      .send(body);
  };

  /** Inserts an active subscription so live mode is usable (default: Pro monthly). */
  const subscribe = async (session: Session, key = 'pro_monthly') => {
    const plan = await ctx.ownerPool.query<{ id: string }>(
      'select id from plans where key = $1',
      [key],
    );
    await ctx.ownerPool.query(
      `insert into subscriptions (organization_id, plan_id, status, started_at)
       values ($1, $2, 'active', now())`,
      [session.orgId, plan.rows[0].id],
    );
    await ctx.app.get(EntitlementsService).clear(session.orgId);
    await ctx.app.get(SubscriptionsService).clear(session.orgId);
  };

  /** Creates an API key and returns the full key (shown once). */
  const createApiKey = async (
    session: Session,
    type: 'publishable' | 'secret',
    mode: Mode,
  ) =>
    (await dash('post', '/api-keys', session, mode).send({ type }).expect(201))
      .body.data.key as string;

  /** Body for POST /dashboard/locations. */
  const location = (name: string) => ({
    name,
    address: '1 Admiralty Way',
    city: 'Lagos',
    timezone: 'Africa/Lagos',
  });

  return {
    ctx,
    paystack,
    cloudinary,
    brevoSends,
    http,
    seq,
    dash,
    api,
    signup,
    inviteToken,
    joinAs,
    verify,
    connectPaystack,
    verifyWebhook,
    paystackWebhook,
    billingWebhook,
    subscribe,
    createApiKey,
    location,
  };
}
