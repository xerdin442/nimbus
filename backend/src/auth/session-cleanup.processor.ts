import { Processor, WorkerHost } from '@nestjs/bullmq';
import { and, inArray, isNull, lt, or } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { refreshTokens, sessions } from '@src/db/schema';
import { Logger } from '@src/common/logger';
import { REFRESH_TOKEN_TTL_MS } from './sessions.service';

const REVOKED_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 1000;

@Processor('auth')
export class SessionCleanupProcessor extends WorkerHost {
  private readonly logger = Logger(SessionCleanupProcessor.name);

  constructor(private readonly db: DbService) {
    super();
  }

  async process(): Promise<void> {
    const now = Date.now();
    const revokedBefore = new Date(now - REVOKED_SESSION_RETENTION_MS);
    const idleSince = new Date(now - REFRESH_TOKEN_TTL_MS);
    const expiredBefore = new Date(now);

    let deletedSessions = 0;
    for (;;) {
      const batch = this.db.client
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          or(
            lt(sessions.revokedAt, revokedBefore),
            and(isNull(sessions.revokedAt), lt(sessions.lastUsedAt, idleSince)),
          ),
        )
        .limit(BATCH_SIZE);

      const deleted = await this.db.client
        .delete(sessions)
        .where(inArray(sessions.id, batch))
        .returning({ id: sessions.id });

      deletedSessions += deleted.length;
      if (deleted.length < BATCH_SIZE) break;
    }

    let deletedTokens = 0;
    for (;;) {
      const batch = this.db.client
        .select({ id: refreshTokens.id })
        .from(refreshTokens)
        .where(lt(refreshTokens.expiresAt, expiredBefore))
        .limit(BATCH_SIZE);

      const deleted = await this.db.client
        .delete(refreshTokens)
        .where(inArray(refreshTokens.id, batch))
        .returning({ id: refreshTokens.id });

      deletedTokens += deleted.length;
      if (deleted.length < BATCH_SIZE) break;
    }

    if (deletedSessions || deletedTokens) {
      this.logger.info(
        `Pruned ${deletedSessions} session(s) and ${deletedTokens} expired refresh token(s)`,
      );
    }
  }
}
