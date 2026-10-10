import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Pool } from 'pg';
import { AppModule } from '@src/app.module';
import { configureApp } from '@src/app.setup';
import type { RedisClientType } from 'redis';
import { PlatformMailService } from '@src/notifications/platform-mail.service';
import { REDIS_CLIENT } from '@src/common/cache';
import { createOwnerPool, resetTestDatabase } from './utils/test-db';

/**
 * Phase 1 over HTTP: the real app, test database and Redis. Only the outside world is faked:
 * fetch to Paystack / Brevo is stubbed, and platform emails go to the log driver (captured).
 */
describe('Org setup (e2e)', () => {
  let app: INestApplication<App>;
  let ownerPool: Pool;
  let platformMail: jest.SpyInstance;

  // Fake outbound HTTP. Paystack accepts keys ending in "good"; Brevo accepts any key but "bad".
  const realFetch = globalThis.fetch;
  const fetchMock = jest.spyOn(globalThis, 'fetch');

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const routeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
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

  const http = () => request(app.getHttpServer());

  interface Session {
    accessToken: string;
    refreshToken: string;
    orgId: string;
    email: string;
  }

  let counter = 0;
  const signup = async (orgName = 'Filmhouse'): Promise<Session> => {
    const email = `owner${++counter}@example.com`;
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

  /**
   * Dashboard request as `session`, in `mode` (default: header omitted = live). No org header:
   * a user belongs to one org, resolved from the session.
   */
  const dash = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    session: Session,
    mode?: 'test' | 'live',
  ) => {
    const req = http()
      [method](`/api/dashboard${path}`)
      .set('authorization', `Bearer ${session.accessToken}`);
    return mode ? req.set('x-nimbus-mode', mode) : req;
  };

  interface InviteOptions {
    role?: 'manager' | 'staff';
    locationIds?: string[];
  }

  /** `inviter` invites `email` (default: staff, all locations); returns the emailed token. */
  const inviteToken = async (
    inviter: Session,
    email: string,
    { role = 'staff', locationIds }: InviteOptions = {},
  ) => {
    platformMail.mockClear();
    await dash('post', '/members/invitations', inviter)
      .send({ email, role, locationIds })
      .expect(201);
    const [, sent] = platformMail.mock.calls[0] as [string, { text: string }];
    return /token=([\w-]+)/.exec(sent.text)![1];
  };

  /** A new user who accepted `inviter`'s invite. */
  const joinAs = async (
    inviter: Session,
    email: string,
    options: InviteOptions = {},
  ) => {
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

  const joinAsStaff = (inviter: Session, email: string) =>
    joinAs(inviter, email);

  const location = (name: string) => ({
    name,
    address: '1 Admiralty Way',
    city: 'Lagos',
    timezone: 'Africa/Lagos',
  });

  beforeAll(async () => {
    ownerPool = createOwnerPool();
    await resetTestDatabase(ownerPool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(
      moduleRef.createNestApplication<INestApplication<App>>(),
    );
    await app.init();

    platformMail = jest.spyOn(app.get(PlatformMailService), 'send');
  });

  beforeEach(() => {
    fetchMock.mockImplementation(routeFetch);
  });

  afterAll(async () => {
    fetchMock.mockRestore();
    await app?.close();
    await ownerPool?.end();
  });

  describe('auth', () => {
    it('signs up an owner with a new org and returns tokens', async () => {
      const session = await signup();

      const me = await http()
        .get('/api/auth/me')
        .set('authorization', `Bearer ${session.accessToken}`)
        .expect(200);

      expect(me.body.data.user.email).toBe(session.email);
      expect(me.body.data.user.passwordHash).toBeUndefined();
      expect(me.body.data.organization).toEqual(
        expect.objectContaining({
          id: session.orgId,
          role: 'owner',
          isVerified: false,
        }),
      );
    });

    it('rejects a duplicate email with email_already_exists', async () => {
      const session = await signup();
      const res = await http()
        .post('/api/auth/signup')
        .send({
          name: 'Again',
          email: session.email.toUpperCase(),
          password: 'correct-horse-battery',
          organization: { name: 'Other', country: 'NG', currency: 'NGN' },
        })
        .expect(409);

      expect(res.body.error.code).toBe('email_already_exists');
    });

    it('logs in, and rejects a wrong password without revealing which part was wrong', async () => {
      const session = await signup();

      await http()
        .post('/api/auth/login')
        .send({ email: session.email, password: 'correct-horse-battery' })
        .expect(200);

      const wrongPassword = await http()
        .post('/api/auth/login')
        .send({ email: session.email, password: 'wrong-password-123' })
        .expect(401);
      const unknownEmail = await http()
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-password-123' })
        .expect(401);

      expect(wrongPassword.body.error).toEqual(unknownEmail.body.error);
    });

    it('rotates refresh tokens and revokes the session when one is reused', async () => {
      const session = await signup();

      const first = await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(200);
      const rotated = first.body.data.refreshToken;
      expect(rotated).not.toBe(session.refreshToken);

      // Replaying the old token = theft signal: it fails, and so does the rotated one.
      const replay = await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      expect(replay.body.error.code).toBe('refresh_token_reused');

      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: rotated })
        .expect(401);
    });

    it('lists sessions per device and signs one out remotely', async () => {
      const laptop = await signup();
      const phoneLogin = await http()
        .post('/api/auth/login')
        .set('user-agent', 'NimbusTest/Phone')
        .send({ email: laptop.email, password: 'correct-horse-battery' })
        .expect(200);
      const phone = phoneLogin.body.data.tokens as {
        accessToken: string;
        refreshToken: string;
      };

      const listed = await http()
        .get('/api/auth/sessions')
        .set('authorization', `Bearer ${laptop.accessToken}`)
        .expect(200);
      const sessions = listed.body.data as {
        id: string;
        current: boolean;
        userAgent: string | null;
      }[];
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((s) => s.current)).toHaveLength(1);
      const phoneSession = sessions.find(
        (s) => s.userAgent === 'NimbusTest/Phone',
      )!;
      expect(phoneSession.current).toBe(false);

      // From the laptop, sign the phone out: its refresh token AND its still-unexpired access
      // token stop working immediately.
      await http()
        .delete(`/api/auth/sessions/${phoneSession.id}`)
        .set('authorization', `Bearer ${laptop.accessToken}`)
        .expect(204);
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: phone.refreshToken })
        .expect(401);
      const revoked = await http()
        .get('/api/auth/me')
        .set('authorization', `Bearer ${phone.accessToken}`)
        .expect(401);
      expect(revoked.body.error.code).toBe('session_revoked');

      // The laptop is unaffected.
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: laptop.refreshToken })
        .expect(200);

      // A user can't revoke someone else's session.
      const other = await signup();
      await http()
        .delete(`/api/auth/sessions/${phoneSession.id}`)
        .set('authorization', `Bearer ${other.accessToken}`)
        .expect(404);
    });

    it('logout signs out only that session', async () => {
      const session = await signup();
      const second = await http()
        .post('/api/auth/login')
        .send({ email: session.email, password: 'correct-horse-battery' })
        .expect(200);

      await http()
        .post('/api/auth/logout')
        .send({ refreshToken: session.refreshToken })
        .expect(204);

      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      await http()
        .get('/api/auth/me')
        .set('authorization', `Bearer ${session.accessToken}`)
        .expect(401);
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: second.body.data.tokens.refreshToken as string })
        .expect(200);
    });

    const login = (email: string, userAgent: string) =>
      http()
        .post('/api/auth/login')
        .set('user-agent', userAgent)
        .send({ email, password: 'correct-horse-battery' });

    it('allows 2 devices: a 3rd login signs out the least recently used session', async () => {
      const first = await signup(); // device 1 (signup counts as a login)
      const second = await login(first.email, 'Device 2').expect(200);
      const secondTokens = second.body.data.tokens as {
        accessToken: string;
        refreshToken: string;
      };

      // Device 2 refreshes, so device 1 becomes the least recently used.
      const refreshed = await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: secondTokens.refreshToken })
        .expect(200);

      const third = await login(first.email, 'Device 3').expect(200);

      // Device 1 is evicted: access and refresh tokens both rejected.
      await http()
        .get('/api/auth/me')
        .set('authorization', `Bearer ${first.accessToken}`)
        .expect(401);
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);

      // Devices 2 and 3 remain.
      const listed = await http()
        .get('/api/auth/sessions')
        .set(
          'authorization',
          `Bearer ${third.body.data.tokens.accessToken as string}`,
        )
        .expect(200);
      expect(
        (listed.body.data as { userAgent: string }[])
          .map((s) => s.userAgent)
          .sort(),
      ).toEqual(['Device 2', 'Device 3']);
      await http()
        .get('/api/auth/me')
        .set(
          'authorization',
          `Bearer ${refreshed.body.data.accessToken as string}`,
        )
        .expect(200);
    });

    it('never exceeds 2 sessions under concurrent logins', async () => {
      const user = await signup();

      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          login(user.email, `Parallel ${i}`).expect(200),
        ),
      );

      const { rows } = await ownerPool.query<{ active: number }>(
        `select count(*)::int as active from sessions s
           join users u on u.id = s.user_id
          where u.email = $1 and s.revoked_at is null`,
        [user.email],
      );
      expect(rows[0].active).toBe(2);
    });
  });

  describe('dashboard context', () => {
    it('resolves the org from the session, and blocks a user removed from their org', async () => {
      const owner = await signup();
      const staff = await joinAsStaff(owner, 'removed@example.com');

      await dash('get', '/locations', staff).expect(200);

      await dash('delete', `/members/${staff.userId}`, owner).expect(204);

      // Same, still-valid access token: the membership is checked on every request.
      const blocked = await dash('get', '/locations', staff).expect(403);
      expect(blocked.body.error.code).toBe('no_organization');

      const me = await http()
        .get('/api/auth/me')
        .set('authorization', `Bearer ${staff.accessToken}`)
        .expect(200);
      expect(me.body.data.organization).toBeNull();
    });

    it('rejects an invalid X-Nimbus-Mode', async () => {
      const session = await signup();

      await dash('get', '/locations', session)
        .set('x-nimbus-mode', 'production')
        .expect(400);
    });
  });

  describe('done when: create org, location, screen with layout, movie', () => {
    it('builds a full catalog over HTTP', async () => {
      const session = await signup();

      const loc = await dash('post', '/locations', session)
        .send(location('Filmhouse Lekki'))
        .expect(201);
      const locationId = loc.body.data.id;

      const screen = await dash(
        'post',
        `/locations/${locationId}/screens`,
        session,
      )
        .send({ name: 'Screen 1', format: 'IMAX' })
        .expect(201);
      const screenId = screen.body.data.id;

      const layout = await dash('put', `/screens/${screenId}/layout`, session)
        .send({
          rows: 2,
          columns: 3,
          seats: [
            { row: 0, column: 0 },
            { row: 0, column: 2 },
            { row: 1, column: 1, type: 'wheelchair' },
          ],
        })
        .expect(200);
      expect(layout.body.data).toMatchObject({ version: 1, capacity: 3 });
      expect(
        layout.body.data.seats.map(
          (s: { rowLabel: string; number: number }) =>
            `${s.rowLabel}${s.number}`,
        ),
      ).toEqual(['A1', 'A2', 'B1']);

      // Seats carry only their label, grid position and type — no ids or ownership columns.
      const current = await dash(
        'get',
        `/screens/${screenId}/layout`,
        session,
      ).expect(200);
      for (const body of [layout.body, current.body]) {
        expect(body.data.seats[2]).toEqual({
          gridRow: 1,
          gridColumn: 1,
          rowLabel: 'B',
          number: 1,
          type: 'wheelchair',
        });
      }

      // Saving again creates version 2; version 1 is kept for showtimes published on it.
      const v2 = await dash('put', `/screens/${screenId}/layout`, session)
        .send({ rows: 1, columns: 1, seats: [{ row: 0, column: 0 }] })
        .expect(200);
      expect(v2.body.data).toMatchObject({ version: 2, capacity: 1 });

      // Custom skipped row letters replace the I/O/Q default.
      const v3 = await dash('put', `/screens/${screenId}/layout`, session)
        .send({
          rows: 1,
          columns: 1,
          seats: [{ row: 0, column: 0 }],
          skipRowLetters: ['A'],
        })
        .expect(200);
      expect(v3.body.data.seats[0].rowLabel).toBe('B');

      for (const skipRowLetters of [['1'], ['AB'], ['a', 'A']]) {
        await dash('put', `/screens/${screenId}/layout`, session)
          .send({
            rows: 1,
            columns: 1,
            seats: [{ row: 0, column: 0 }],
            skipRowLetters,
          })
          .expect(400);
      }

      const movie = await dash('post', '/movies', session)
        .send({
          title: 'Anikulapo',
          runtimeMinutes: 142,
          rating: '15',
          genres: ['Drama'],
          posterUrl: 'https://example.com/poster.jpg',
        })
        .expect(201);
      expect(movie.body.data.title).toBe('Anikulapo');

      for (const title of ['Gangs of Lagos', 'Jagun Jagun']) {
        await dash('post', '/movies', session)
          .send({ title, runtimeMinutes: 120 })
          .expect(201);
      }

      // Newest first, paginated.
      const page1 = await dash('get', '/movies?limit=2', session).expect(200);
      expect(page1.body.data.map((m: { title: string }) => m.title)).toEqual([
        'Jagun Jagun',
        'Gangs of Lagos',
      ]);
      expect(page1.body.meta).toEqual({
        total: 3,
        page: 1,
        limit: 2,
        totalPages: 2,
        hasNextPage: true,
        hasPrevPage: false,
      });

      const page2 = await dash('get', '/movies?limit=2&page=2', session).expect(
        200,
      );
      expect(page2.body.data.map((m: { title: string }) => m.title)).toEqual([
        'Anikulapo',
      ]);
      expect(page2.body.meta).toMatchObject({
        page: 2,
        hasNextPage: false,
        hasPrevPage: true,
      });

      await dash('get', '/movies?limit=100', session).expect(200);
      await dash('get', '/movies?limit=101', session).expect(400);
    });
  });

  describe('done when: 4th location refused with plan_limit_reached', () => {
    it('allows 3 locations on Basic and refuses the 4th with details', async () => {
      const session = await signup();

      for (const name of ['One', 'Two', 'Three']) {
        await dash('post', '/locations', session)
          .send(location(name))
          .expect(201);
      }

      const res = await dash('post', '/locations', session)
        .send(location('Four'))
        .expect(403);

      expect(res.body.error).toEqual({
        code: 'plan_limit_reached',
        message: expect.any(String),
        details: { key: 'locations.max', limit: 3, current: 3 },
      });
    });

    it('holds under concurrent requests: 6 parallel creates → exactly 3 succeed', async () => {
      const session = await signup();

      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          dash('post', '/locations', session).send(location(`Parallel ${i}`)),
        ),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status === 403)).toHaveLength(3);

      const list = await dash('get', '/locations', session).expect(200);
      expect(list.body.data).toHaveLength(3);
    });

    it('frees a slot when a location is archived, and re-checks on unarchive', async () => {
      const session = await signup();
      const ids: string[] = [];
      for (const name of ['One', 'Two', 'Three']) {
        const res = await dash('post', '/locations', session)
          .send(location(name))
          .expect(201);
        ids.push(res.body.data.id as string);
      }

      await dash('post', `/locations/${ids[0]}/archive`, session).expect(200);
      await dash('post', '/locations', session)
        .send(location('Four'))
        .expect(201);

      const res = await dash(
        'post',
        `/locations/${ids[0]}/unarchive`,
        session,
      ).expect(403);
      expect(res.body.error.code).toBe('plan_limit_reached');
    });
  });

  describe('tenant isolation over HTTP', () => {
    it("can't read another org's location even with its id", async () => {
      const a = await signup('Org A');
      const b = await signup('Org B');

      const loc = await dash('post', '/locations', a)
        .send(location('A only'))
        .expect(201);

      await dash('get', `/locations/${loc.body.data.id}`, b).expect(404);
      const listB = await dash('get', '/locations', b).expect(200);
      expect(listB.body.data).toEqual([]);
    });
  });

  describe('members and roles', () => {
    it('invites a staff member scoped to one location; staff can read but not create', async () => {
      const owner = await signup();
      const lekki = await dash('post', '/locations', owner)
        .send(location('Lekki'))
        .expect(201);
      await dash('post', '/locations', owner)
        .send(location('Surulere'))
        .expect(201);

      platformMail.mockClear();
      const invite = await dash('post', '/members/invitations', owner)
        .send({
          email: 'Staff@Example.com',
          role: 'staff',
          locationIds: [lekki.body.data.id],
        })
        .expect(201);
      expect(invite.body.data.emailSent).toBe(true);
      expect(invite.body.data.invitation.tokenHash).toBeUndefined();

      const [to, email] = platformMail.mock.calls[0] as [
        string,
        { text: string },
      ];
      expect(to).toBe('staff@example.com');
      const token = /token=([\w-]+)/.exec(email.text)![1];

      const accepted = await http()
        .post('/api/auth/invitations/accept')
        .send({ token, name: 'Sam Staff', password: 'staff-password-1' })
        .expect(200);
      const staff = {
        ...owner,
        accessToken: accepted.body.data.tokens.accessToken,
      };

      // The token is single-use.
      await http()
        .post('/api/auth/invitations/accept')
        .send({ token, name: 'Sam Staff', password: 'staff-password-1' })
        .expect(400);

      const visible = await dash('get', '/locations', staff).expect(200);
      expect(visible.body.data.map((l: { name: string }) => l.name)).toEqual([
        'Lekki',
      ]);

      const denied = await dash('post', '/locations', staff)
        .send(location('Nope'))
        .expect(403);
      expect(denied.body.error.code).toBe('insufficient_role');
    });

    it('refuses to invite someone who already belongs to another org', async () => {
      const ownerA = await signup('Org A');
      const ownerB = await signup('Org B');

      const res = await dash('post', '/members/invitations', ownerA)
        .send({ email: ownerB.email, role: 'manager' })
        .expect(409);
      expect(res.body.error.code).toBe('email_belongs_to_another_org');
    });

    it('refuses an accept if the invitee joined another org after being invited', async () => {
      const ownerA = await signup('Org A');
      const ownerB = await signup('Org B');
      const email = 'two-invites@example.com';

      const tokenA = await inviteToken(ownerA, email);
      const tokenB = await inviteToken(ownerB, email);

      await http()
        .post('/api/auth/invitations/accept')
        .send({ token: tokenA, name: 'Sam', password: 'staff-password-1' })
        .expect(200);

      const second = await http()
        .post('/api/auth/invitations/accept')
        .send({ token: tokenB })
        .expect(409);
      expect(second.body.error.code).toBe('email_belongs_to_another_org');

      // The refused accept rolled back: Org B's invite is still pending.
      const pending = await dash('get', '/members', ownerB).expect(200);
      expect(
        (pending.body.data.invitations as { email: string }[]).map(
          (i) => i.email,
        ),
      ).toEqual([email]);
    });

    it('never lets the last owner demote or remove themselves', async () => {
      const owner = await signup();
      const me = await http()
        .get('/api/auth/me')
        .set('authorization', `Bearer ${owner.accessToken}`);
      const userId = me.body.data.user.id;

      const res = await dash('patch', `/members/${userId}`, owner)
        .send({ role: 'manager' })
        .expect(409);
      expect(res.body.error.code).toBe('last_owner');
      await dash('delete', `/members/${userId}`, owner).expect(409);
    });
  });

  describe('manager permissions', () => {
    /** Owner, two locations, and a manager scoped to Lekki only. */
    const managerSetup = async () => {
      const owner = await signup();
      const lekki = (
        await dash('post', '/locations', owner)
          .send(location('Lekki'))
          .expect(201)
      ).body.data.id as string;
      const ikeja = (
        await dash('post', '/locations', owner)
          .send(location('Ikeja'))
          .expect(201)
      ).body.data.id as string;
      const manager = await joinAs(owner, `mgr-${++counter}@example.com`, {
        role: 'manager',
        locationIds: [lekki],
      });
      const ownerId = (
        await http()
          .get('/api/auth/me')
          .set('authorization', `Bearer ${owner.accessToken}`)
      ).body.data.user.id as string;

      return { owner, ownerId, manager, lekki, ikeja };
    };

    const invite = (
      inviter: Session,
      body: { email: string; role: string; locationIds?: string[] },
    ) => dash('post', '/members/invitations', inviter).send(body);

    it('invites staff to their own locations only', async () => {
      const { manager, lekki, ikeja } = await managerSetup();

      await invite(manager, {
        email: `s${++counter}@example.com`,
        role: 'staff',
        locationIds: [lekki],
      }).expect(201);

      const allLocations = await invite(manager, {
        email: `s${++counter}@example.com`,
        role: 'staff',
      }).expect(403);
      expect(allLocations.body.error.code).toBe('location_forbidden');

      const otherLocation = await invite(manager, {
        email: `s${++counter}@example.com`,
        role: 'staff',
        locationIds: [ikeja],
      }).expect(403);
      expect(otherLocation.body.error.code).toBe('location_forbidden');

      const aManager = await invite(manager, {
        email: `s${++counter}@example.com`,
        role: 'manager',
        locationIds: [lekki],
      }).expect(403);
      expect(aManager.body.error.code).toBe('insufficient_role');
    });

    // Basic allows 5 members incl. pending invites, so members and invitations get a test each.
    it('lists only members within their locations', async () => {
      const { owner, manager, lekki, ikeja } = await managerSetup();
      const lekkiStaff = await joinAs(owner, `s${++counter}@example.com`, {
        locationIds: [lekki],
      });
      await joinAs(owner, `s${++counter}@example.com`, {
        locationIds: [ikeja],
      });

      const res = await dash('get', '/members', manager).expect(200);

      // Not the owner (all locations) or Ikeja staff.
      expect(
        (res.body.data.members as { email: string }[])
          .map((m) => m.email)
          .sort(),
      ).toEqual([lekkiStaff.email, manager.email].sort());
    });

    it('lists only invitations within their locations', async () => {
      const { owner, manager, lekki, ikeja } = await managerSetup();
      const pendingLekki = `p${++counter}@example.com`;
      await inviteToken(owner, pendingLekki, { locationIds: [lekki] });
      await inviteToken(owner, `p${++counter}@example.com`, {
        locationIds: [ikeja],
      });

      const res = await dash('get', '/members', manager).expect(200);

      expect(
        (res.body.data.invitations as { email: string }[]).map((i) => i.email),
      ).toEqual([pendingLekki]);
    });

    it('updates and removes staff in their locations, but never owners or managers', async () => {
      const { owner, ownerId, manager, lekki, ikeja } = await managerSetup();
      const lekkiStaff = await joinAs(owner, `s${++counter}@example.com`, {
        locationIds: [lekki],
      });
      const ikejaStaff = await joinAs(owner, `s${++counter}@example.com`, {
        locationIds: [ikeja],
      });
      const otherManager = await joinAs(owner, `m${++counter}@example.com`, {
        role: 'manager',
        locationIds: [lekki],
      });

      await dash('patch', `/members/${lekkiStaff.userId}`, manager)
        .send({ locationIds: [lekki] })
        .expect(200);

      const promote = await dash(
        'patch',
        `/members/${lekkiStaff.userId}`,
        manager,
      )
        .send({ role: 'manager' })
        .expect(403);
      expect(promote.body.error.code).toBe('insufficient_role');

      const move = await dash('patch', `/members/${lekkiStaff.userId}`, manager)
        .send({ locationIds: [ikeja] })
        .expect(403);
      expect(move.body.error.code).toBe('location_forbidden');

      for (const res of [
        await dash('patch', `/members/${ownerId}`, manager).send({
          locationIds: [lekki],
        }),
        await dash('delete', `/members/${ownerId}`, manager),
        await dash('delete', `/members/${otherManager.userId}`, manager),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('insufficient_role');
      }

      const outside = await dash(
        'delete',
        `/members/${ikejaStaff.userId}`,
        manager,
      ).expect(403);
      expect(outside.body.error.code).toBe('location_forbidden');

      await dash('delete', `/members/${lekkiStaff.userId}`, manager).expect(
        204,
      );
    });

    it('resends and revokes only invitations within their locations', async () => {
      const { owner, manager, lekki, ikeja } = await managerSetup();
      await inviteToken(owner, `p${++counter}@example.com`, {
        locationIds: [lekki],
      });
      await inviteToken(owner, `p${++counter}@example.com`, {
        locationIds: [ikeja],
      });
      const pending = (await dash('get', '/members', owner).expect(200)).body
        .data.invitations as { id: string; locationIds: string[] }[];
      const lekkiInvite = pending.find((i) => i.locationIds[0] === lekki)!;
      const ikejaInvite = pending.find((i) => i.locationIds[0] === ikeja)!;

      await dash(
        'post',
        `/members/invitations/${lekkiInvite.id}/resend`,
        manager,
      ).expect(200);
      await dash(
        'delete',
        `/members/invitations/${lekkiInvite.id}`,
        manager,
      ).expect(204);

      for (const res of [
        await dash(
          'post',
          `/members/invitations/${ikejaInvite.id}/resend`,
          manager,
        ),
        await dash('delete', `/members/invitations/${ikejaInvite.id}`, manager),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('location_forbidden');
      }
    });

    it('lets general managers manage scoped managers, but never owners or fellow general managers', async () => {
      const { owner, ownerId, manager, lekki, ikeja } = await managerSetup();
      const generalManager = await joinAs(owner, `gm${++counter}@example.com`, {
        role: 'manager',
      });
      const ikejaManager = await joinAs(
        generalManager,
        `m${++counter}@example.com`,
        { role: 'manager', locationIds: [ikeja] },
      );

      await dash('patch', `/members/${manager.userId}`, generalManager)
        .send({ locationIds: [lekki, ikeja] })
        .expect(200);

      for (const res of [
        await invite(generalManager, {
          email: `gm${++counter}@example.com`,
          role: 'manager',
        }),
        await dash('patch', `/members/${manager.userId}`, generalManager).send({
          locationIds: [],
        }),
        await dash('patch', `/members/${ownerId}`, generalManager).send({
          role: 'manager',
        }),
        await dash('delete', `/members/${ownerId}`, generalManager),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('insufficient_role');
      }

      // Only owners promote to general manager, after which a fellow GM can't touch them.
      await dash('patch', `/members/${manager.userId}`, owner)
        .send({ locationIds: [] })
        .expect(200);
      const fellow = await dash(
        'delete',
        `/members/${manager.userId}`,
        generalManager,
      ).expect(403);
      expect(fellow.body.error.code).toBe('insufficient_role');

      await dash(
        'delete',
        `/members/${ikejaManager.userId}`,
        generalManager,
      ).expect(204);
    });

    it('lets only owners and general managers archive movies', async () => {
      const { owner, manager, lekki } = await managerSetup();
      const generalManager = await joinAs(owner, `gm${++counter}@example.com`, {
        role: 'manager',
      });
      const staff = await joinAs(owner, `s${++counter}@example.com`, {
        locationIds: [lekki],
      });
      const movieId = (
        await dash('post', '/movies', owner)
          .send({ title: 'Anikulapo', runtimeMinutes: 142 })
          .expect(201)
      ).body.data.id as string;

      for (const action of ['archive', 'unarchive']) {
        const scoped = await dash(
          'post',
          `/movies/${movieId}/${action}`,
          manager,
        ).expect(403);
        expect(scoped.body.error.code).toBe('location_forbidden');

        const asStaff = await dash(
          'post',
          `/movies/${movieId}/${action}`,
          staff,
        ).expect(403);
        expect(asStaff.body.error.code).toBe('insufficient_role');

        await dash(
          'post',
          `/movies/${movieId}/${action}`,
          generalManager,
        ).expect(200);
      }

      await dash('post', `/movies/${movieId}/archive`, owner).expect(200);
      await dash('post', `/movies/${movieId}/unarchive`, owner).expect(200);
    });

    it('lets owners manage fellow owners', async () => {
      const { owner, ownerId, manager } = await managerSetup();

      await dash('patch', `/members/${manager.userId}`, owner)
        .send({ role: 'owner', locationIds: [] })
        .expect(200);

      // The new owner can now demote the original owner (one owner still remains).
      await dash('patch', `/members/${ownerId}`, manager)
        .send({ role: 'manager' })
        .expect(200);
    });
  });

  describe('provider connections and verification', () => {
    it('rejects a key for the wrong mode and a key Paystack refuses', async () => {
      const session = await signup();

      const mismatch = await dash('put', '/payment-config', session, 'test')
        .send({ secretKey: 'sk_live_good' })
        .expect(422);
      expect(mismatch.body.error.code).toBe('key_mode_mismatch');

      const refused = await dash('put', '/payment-config', session, 'test')
        .send({ secretKey: 'sk_test_bad' })
        .expect(422);
      expect(refused.body.error.code).toBe('payment_connection_failed');
    });

    it('keeps test and live payment configs apart, and never returns the secret', async () => {
      const session = await signup();

      const saved = await dash('put', '/payment-config', session, 'test')
        .send({ secretKey: 'sk_test_good' })
        .expect(200);
      expect(saved.body.data.config).toMatchObject({
        livemode: false,
        last4: 'good',
      });
      expect(saved.body.data.config.encryptedSecret).toBeUndefined();

      const live = await dash('get', '/payment-config', session, 'live').expect(
        200,
      );
      expect(live.body.data).toBeNull();
    });

    it('verifies the org once the live Paystack key and the email provider both connect', async () => {
      const session = await signup();

      // Test mode alone never verifies.
      await dash('put', '/payment-config', session, 'test')
        .send({ secretKey: 'sk_test_good' })
        .expect(200);

      const failedMail = await dash('put', '/mail-config', session)
        .send({
          provider: 'brevo',
          apiKey: 'bad',
          fromEmail: 'tickets@filmhouse.test',
          fromName: 'Filmhouse',
        })
        .expect(422);
      expect(failedMail.body.error.code).toBe('mail_connection_failed');

      const mail = await dash('put', '/mail-config', session)
        .send({
          provider: 'brevo',
          apiKey: 'xkeysib-good',
          fromEmail: 'tickets@filmhouse.test',
          fromName: 'Filmhouse',
        })
        .expect(200);
      expect(mail.body.data.isVerified).toBe(false);

      const payment = await dash('put', '/payment-config', session, 'live')
        .send({ secretKey: 'sk_live_good' })
        .expect(200);
      expect(payment.body.data.isVerified).toBe(true);

      const org = await dash('get', '/organization', session).expect(200);
      expect(org.body.data.verification).toMatchObject({
        isVerified: true,
        paymentConfig: { test: 'verified', live: 'verified' },
        mailConfig: 'verified',
      });
    });
  });

  describe('API keys and the public API', () => {
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

    it('creates test keys any time, but live keys only for a verified org', async () => {
      const session = await signup();

      const testKey = await dash('post', '/api-keys', session, 'test')
        .send({ type: 'secret' })
        .expect(201);
      expect(testKey.body.data.key).toMatch(/^sk_test_[a-z0-9]{32}$/);

      const denied = await dash('post', '/api-keys', session, 'live')
        .send({ type: 'publishable' })
        .expect(403);
      expect(denied.body.error.code).toBe('org_not_verified');

      await verify(session);
      const liveKey = await dash('post', '/api-keys', session, 'live')
        .send({ type: 'publishable' })
        .expect(201);
      expect(liveKey.body.data.key).toMatch(/^pk_live_/);

      // The full key is shown once; listing only shows the prefix.
      const list = await dash('get', '/api-keys', session, 'live').expect(200);
      expect(list.body.data[0].key).toBeUndefined();
      expect(list.body.data[0].prefix).toBe(liveKey.body.data.key.slice(0, 12));
    });

    it('limits live keys to the plan (Basic: 2); rolling a key does not count as a new one', async () => {
      const session = await signup();
      await verify(session);

      const first = await dash('post', '/api-keys', session, 'live')
        .send({ type: 'publishable' })
        .expect(201);
      await dash('post', '/api-keys', session, 'live')
        .send({ type: 'secret' })
        .expect(201);
      const third = await dash('post', '/api-keys', session, 'live')
        .send({ type: 'secret' })
        .expect(403);
      expect(third.body.error.details).toMatchObject({
        key: 'api_keys.live.max',
        limit: 2,
      });

      const rolled = await dash(
        'post',
        `/api-keys/${first.body.data.id}/roll`,
        session,
        'live',
      ).expect(200);
      expect(rolled.body.data.key).not.toBe(first.body.data.key);
    });

    it("serves /api/v1 with the key's org and mode, and rejects bad or revoked keys", async () => {
      const a = await signup('Org A');
      const b = await signup('Org B');
      await dash('post', '/locations', a).send(location('A Lekki')).expect(201);
      await dash('post', '/locations', b).send(location('B Ikeja')).expect(201);

      const key = await dash('post', '/api-keys', a, 'test')
        .send({ type: 'publishable' })
        .expect(201);
      const pk = key.body.data.key as string;

      const res = await http()
        .get('/api/v1/locations')
        .set('authorization', `Bearer ${pk}`)
        .set('origin', 'https://www.filmhouse.test')
        .expect(200);
      expect(res.body.data.map((l: { name: string }) => l.name)).toEqual([
        'A Lekki',
      ]);
      // Any storefront origin may call the public API: the key is the credential.
      expect(res.headers['access-control-allow-origin']).toBe(
        'https://www.filmhouse.test',
      );

      await http().get('/api/v1/locations').expect(401);
      await http()
        .get('/api/v1/locations')
        .set('authorization', 'Bearer pk_test_doesnotexistdoesnotexist12345')
        .expect(401);

      await dash('delete', `/api-keys/${key.body.data.id}`, a, 'test').expect(
        200,
      );
      await http()
        .get('/api/v1/locations')
        .set('authorization', `Bearer ${pk}`)
        .expect(401);
    });

    it('keeps dashboard routes restricted to the dashboard origin', async () => {
      const res = await http()
        .get('/api/auth/me')
        .set('origin', 'https://evil.test');

      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:5173',
      );
    });
  });

  describe('password reset', () => {
    const forgot = (email: string) =>
      http().post('/api/auth/password/forgot').send({ email }).expect(202);

    /** Requests a reset for `email` and returns the token from the captured email. */
    const resetToken = async (email: string) => {
      platformMail.mockClear();
      await forgot(email);
      expect(platformMail).toHaveBeenCalledTimes(1);
      const [to, sent] = platformMail.mock.calls[0] as [
        string,
        { text: string },
      ];
      expect(to).toBe(email);
      return /token=([\w-]+)/.exec(sent.text)![1];
    };

    const reset = (token: string, password: string) =>
      http().post('/api/auth/password/reset').send({ token, password });

    it('answers the same for unknown emails, and only emails real accounts', async () => {
      const session = await signup();

      platformMail.mockClear();
      const unknown = await forgot('nobody-here@example.com');
      expect(platformMail).not.toHaveBeenCalled();

      const known = await forgot(session.email);
      expect(platformMail).toHaveBeenCalledTimes(1);

      expect(known.body).toEqual(unknown.body);
    });

    it('resets the password, signs out every session, and works only once', async () => {
      const session = await signup();
      const token = await resetToken(session.email);

      await reset(token, 'brand-new-password').expect(204);

      // Old password no longer works; the new one does.
      await http()
        .post('/api/auth/login')
        .send({ email: session.email, password: 'correct-horse-battery' })
        .expect(401);
      await http()
        .post('/api/auth/login')
        .send({ email: session.email, password: 'brand-new-password' })
        .expect(200);

      // Every pre-reset session is signed out, including its still-valid access token.
      const revoked = await http()
        .get('/api/auth/me')
        .set('authorization', `Bearer ${session.accessToken}`)
        .expect(401);
      expect(revoked.body.error.code).toBe('session_revoked');
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);

      // The link is single-use.
      const reused = await reset(token, 'another-password-1').expect(400);
      expect(reused.body.error.code).toBe('invalid_reset_token');
    });

    it('sends at most one email per minute, and a newer link replaces the older one', async () => {
      const session = await signup();
      const first = await resetToken(session.email);

      // Within the cooldown: no second email.
      platformMail.mockClear();
      await forgot(session.email);
      expect(platformMail).not.toHaveBeenCalled();

      // Simulate the cooldown passing, then request again.
      const redis = app.get<RedisClientType>(REDIS_CLIENT);
      const me = await http()
        .get('/api/auth/me')
        .set('authorization', `Bearer ${session.accessToken}`);
      const userId = me.body.data.user.id as string;
      // TTL now 58 min = issued 2 min ago, past the 1-minute cooldown.
      await redis.expire(`password-reset:user:${userId}`, 60 * 58);
      const second = await resetToken(session.email);

      await reset(first, 'from-the-old-link').expect(400);
      await reset(second, 'from-the-new-link').expect(204);
    });
  });
});
