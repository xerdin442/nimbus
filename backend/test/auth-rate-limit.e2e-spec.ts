import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Pool } from 'pg';
import { AppModule } from '@src/app.module';
import { configureApp } from '@src/app.setup';
import { THROTTLER_MINUTES, THROTTLER_SECONDS } from '@src/common/util';
import { AUTH_RATE_LIMITS } from '@src/common/decorators/auth-throttle.decorator';
import { createOwnerPool, resetTestDatabase } from './utils/test-db';

/**
 * Throttling is off in the other e2e suites (NODE_ENV=test). Here the throttlers are switched on
 * with generous global limits, so only the stricter per-route auth limits can trip.
 */
describe('Auth rate limits (e2e)', () => {
  let app: INestApplication<App>;
  let ownerPool: Pool;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ownerPool = createOwnerPool();
    await resetTestDatabase(ownerPool);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getOptionsToken())
      .useValue([
        { name: THROTTLER_SECONDS, ttl: 1000, limit: 1000 },
        { name: THROTTLER_MINUTES, ttl: 60_000, limit: 1000 },
      ])
      .compile();
    app = configureApp(
      moduleRef.createNestApplication<INestApplication<App>>(),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await ownerPool?.end();
  });

  it(`allows ${AUTH_RATE_LIMITS.login} login attempts per minute per IP, then 429`, async () => {
    const attempt = () =>
      http()
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-password-1' });

    for (let i = 0; i < AUTH_RATE_LIMITS.login; i++) {
      await attempt().expect(401);
    }

    const blocked = await attempt().expect(429);
    // Named throttlers suffix their headers with the throttler name.
    expect(Number(blocked.headers['retry-after-minutes'])).toBeGreaterThan(0);
  });

  it(`allows ${AUTH_RATE_LIMITS.signup} signups per minute per IP, then 429`, async () => {
    const signup = (i: number) =>
      http()
        .post('/api/auth/signup')
        .send({
          name: 'Rate Limited',
          email: `rate${i}@example.com`,
          password: 'correct-horse-battery',
          organization: { name: `Org ${i}`, country: 'NG', currency: 'NGN' },
        });

    for (let i = 0; i < AUTH_RATE_LIMITS.signup; i++) {
      await signup(i).expect(201);
    }

    await signup(AUTH_RATE_LIMITS.signup).expect(429);
  });

  it('keeps the global limit on other routes', async () => {
    // Well past the auth limits, but under the global 1000/min used in this suite.
    for (let i = 0; i < 15; i++) {
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: 'rt_unknown' })
        .expect(401);
    }
  });
});
