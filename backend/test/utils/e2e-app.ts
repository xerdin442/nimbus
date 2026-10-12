import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Pool } from 'pg';
import { AppModule } from '@src/app.module';
import { configureApp } from '@src/app.setup';
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

/** Fake outbound HTTP. Paystack accepts keys ending in "good"; Brevo accepts any key but "bad". */
const fakeFetch =
  (realFetch: typeof fetch) =>
  async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers);

    if (url.startsWith('https://api.paystack.co/')) {
      return headers.get('authorization')?.endsWith('good')
        ? json(200, { status: true, data: [] })
        : json(401, { status: false, message: 'Invalid key' });
    }
    if (url.startsWith('https://api.brevo.com/')) {
      return headers.get('api-key') === 'bad'
        ? json(401, { message: 'Key not found' })
        : json(201, { messageId: '<msg@brevo>' });
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
  const fake = fakeFetch(realFetch);

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
      moduleRef.createNestApplication<INestApplication<App>>(),
    );
    await ctx.app.init();

    ctx.platformMail = jest.spyOn(ctx.app.get(PlatformMailService), 'send');
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
    await dash('put', '/mail-config', session)
      .send({
        provider: 'brevo',
        apiKey: 'xkeysib-good',
        fromEmail: 'tickets@filmhouse.test',
        fromName: 'Filmhouse',
      })
      .expect(200);
    await dash('put', '/payment-config', session, 'live')
      .send({ secretKey: 'sk_live_good' })
      .expect(200);
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
    http,
    seq,
    dash,
    api,
    signup,
    inviteToken,
    joinAs,
    verify,
    createApiKey,
    location,
  };
}
