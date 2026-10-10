import { Pool } from 'pg';
import { DbService } from '@src/db/db.service';
import { SessionCleanupProcessor } from '@src/auth/session-cleanup.processor';
import { createOwnerPool, resetTestDatabase } from './utils/test-db';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

/** The daily prune, run directly against the test database (no queue timing involved). */
describe('Session cleanup (e2e)', () => {
  let ownerPool: Pool;
  let db: DbService;
  let processor: SessionCleanupProcessor;

  const insertSession = async (
    userId: string,
    lastUsedAt: Date,
    revokedAt: Date | null,
  ): Promise<string> => {
    const { rows } = await ownerPool.query<{ id: string }>(
      `insert into sessions (user_id, last_used_at, revoked_at)
       values ($1, $2, $3) returning id`,
      [userId, lastUsedAt, revokedAt],
    );
    return rows[0].id;
  };

  const insertToken = async (
    sessionId: string,
    hash: string,
    expiresAt: Date,
    revokedAt: Date | null,
  ) => {
    await ownerPool.query(
      `insert into refresh_tokens (session_id, token_hash, expires_at, revoked_at)
       values ($1, $2, $3, $4)`,
      [sessionId, hash, expiresAt, revokedAt],
    );
  };

  beforeAll(async () => {
    ownerPool = createOwnerPool();
    await resetTestDatabase(ownerPool);
    db = new DbService(process.env.TEST_DATABASE_URL as string);
    processor = new SessionCleanupProcessor(db);
  });

  afterAll(async () => {
    await db?.onModuleDestroy();
    await ownerPool?.end();
  });

  it('deletes only rows that can never be used again', async () => {
    const { rows } = await ownerPool.query<{ id: string }>(
      `insert into users (email, name, password_hash)
       values ('cleanup@example.com', 'Cleanup', 'x') returning id`,
    );
    const userId = rows[0].id;

    const active = await insertSession(userId, new Date(), null);
    const recentlyRevoked = await insertSession(userId, daysAgo(1), daysAgo(1));
    const longRevoked = await insertSession(userId, daysAgo(9), daysAgo(8));
    const idle = await insertSession(userId, daysAgo(31), null);

    // Active session: an expired token (prunable) and a rotated-but-unexpired one (kept for
    // reuse detection).
    await insertToken(active, 'expired', daysAgo(1), daysAgo(31));
    await insertToken(active, 'rotated', daysFromNow(10), daysAgo(1));
    await insertToken(active, 'current', daysFromNow(30), null);
    await insertToken(longRevoked, 'long-revoked', daysFromNow(5), daysAgo(8));
    await insertToken(idle, 'idle', daysAgo(1), null);

    await processor.process();

    const sessions = await ownerPool.query<{ id: string }>(
      'select id from sessions where user_id = $1',
      [userId],
    );
    expect(sessions.rows.map((s) => s.id).sort()).toEqual(
      [active, recentlyRevoked].sort(),
    );

    const tokens = await ownerPool.query<{ token_hash: string }>(
      'select token_hash from refresh_tokens order by token_hash',
    );
    expect(tokens.rows.map((t) => t.token_hash)).toEqual([
      'current',
      'rotated',
    ]);
  });

  it('is a no-op when there is nothing to prune', async () => {
    await expect(processor.process()).resolves.toBeUndefined();
  });
});
