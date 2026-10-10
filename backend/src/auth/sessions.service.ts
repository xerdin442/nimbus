import {
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DbService } from '@src/db/db.service';
import { refreshTokens, sessions, users } from '@src/db/schema';
import { EncryptionService } from '@src/common/helpers';
import { CodedException } from '@src/common/errors';
import type {
  AuthTokens,
  ClientInfo,
  Database,
  JwtPayload,
  SessionView,
  Transaction,
} from '@src/common/types';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USER_AGENT_MAX = 512;
export const MAX_SESSIONS_PER_USER = 2;

@Injectable()
export class SessionsService {
  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly encryption: EncryptionService,
  ) {}

  async start(userId: string, client: ClientInfo): Promise<AuthTokens> {
    const sessionId = await this.db.client.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');

      const active = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(this.activeSessionsOf(userId))
        .orderBy(asc(sessions.lastUsedAt));

      const evict = active
        .slice(0, Math.max(0, active.length - MAX_SESSIONS_PER_USER + 1))
        .map((s) => s.id);

      if (evict.length) {
        await this.revokeMany(tx, evict);
      }

      const [session] = await tx
        .insert(sessions)
        .values({
          userId,
          userAgent: client.userAgent?.slice(0, USER_AGENT_MAX),
          ipAddress: client.ipAddress,
        })
        .returning({ id: sessions.id });

      return session.id;
    });

    return this.issueTokens(userId, sessionId);
  }

  async refresh(refreshToken: string, client: ClientInfo): Promise<AuthTokens> {
    const [stored] = await this.db.client
      .select({
        id: refreshTokens.id,
        sessionId: refreshTokens.sessionId,
        expiresAt: refreshTokens.expiresAt,
        userId: sessions.userId,
        sessionRevokedAt: sessions.revokedAt,
      })
      .from(refreshTokens)
      .innerJoin(sessions, eq(sessions.id, refreshTokens.sessionId))
      .where(eq(refreshTokens.tokenHash, this.encryption.hash(refreshToken)));

    if (!stored || stored.sessionRevokedAt || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Conditional update: of two concurrent refreshes with the same token, only one wins.
    const [rotated] = await this.db.client
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.id, stored.id), isNull(refreshTokens.revokedAt)),
      )
      .returning({ id: refreshTokens.id });

    if (!rotated) {
      await this.revoke(stored.sessionId);
      throw new CodedException(
        HttpStatus.UNAUTHORIZED,
        'refresh_token_reused',
        'This refresh token was already used; the session was signed out',
      );
    }

    await this.db.client
      .update(sessions)
      .set({ lastUsedAt: new Date(), ipAddress: client.ipAddress })
      .where(eq(sessions.id, stored.sessionId));

    return this.issueTokens(stored.userId, stored.sessionId);
  }

  async logout(refreshToken: string): Promise<void> {
    const [stored] = await this.db.client
      .select({ sessionId: refreshTokens.sessionId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, this.encryption.hash(refreshToken)));

    if (stored) {
      await this.revoke(stored.sessionId);
    }
  }

  async list(userId: string, currentSessionId: string): Promise<SessionView[]> {
    const rows = await this.db.client
      .select()
      .from(sessions)
      .where(this.activeSessionsOf(userId))
      .orderBy(desc(sessions.lastUsedAt));

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return rows.map(({ userId: _, revokedAt, ...session }) => ({
      ...session,
      current: session.id === currentSessionId,
    }));
  }

  async revokeForUser(userId: string, sessionId: string): Promise<void> {
    const [session] = await this.db.client
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
        ),
      );

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    await this.revoke(sessionId);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const active = await this.db.client
      .select({ id: sessions.id })
      .from(sessions)
      .where(this.activeSessionsOf(userId));

    if (active.length) {
      await this.db.client.transaction((tx) =>
        this.revokeMany(
          tx,
          active.map((s) => s.id),
        ),
      );
    }
  }

  private async issueTokens(
    userId: string,
    sessionId: string,
  ): Promise<AuthTokens> {
    const refreshToken = `rt_${randomBytes(32).toString('base64url')}`;

    await this.db.client.insert(refreshTokens).values({
      sessionId,
      tokenHash: this.encryption.hash(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });

    const payload: JwtPayload = { sub: userId, sid: sessionId };

    return {
      accessToken: await this.jwt.signAsync(payload),
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  private async revoke(sessionId: string): Promise<void> {
    await this.db.client.transaction((tx) => this.revokeMany(tx, [sessionId]));
  }

  private async revokeMany(tx: Database | Transaction, sessionIds: string[]) {
    const now = new Date();

    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(inArray(sessions.id, sessionIds), isNull(sessions.revokedAt)));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          inArray(refreshTokens.sessionId, sessionIds),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  /** Not revoked and used within the refresh-token lifetime, i.e. can still refresh. */
  private activeSessionsOf(userId: string) {
    return and(
      eq(sessions.userId, userId),
      isNull(sessions.revokedAt),
      gt(sessions.lastUsedAt, new Date(Date.now() - REFRESH_TOKEN_TTL_MS)),
    );
  }
}
