import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import type { RedisClientType } from 'redis';
import { DbService } from '@src/db/db.service';
import { users } from '@src/db/schema';
import { REDIS_CLIENT } from '@src/common/cache';
import { EncryptionService, PasswordService } from '@src/common/helpers';
import { CodedException } from '@src/common/errors';
import { Secrets } from '@src/common/secrets';
import { Logger } from '@src/common/logger';
import { PlatformMailService } from '@src/notifications/platform-mail.service';
import { passwordResetEmail } from '@src/notifications/templates';
import { SessionsService } from './sessions.service';

const RESET_TTL_SECONDS = 60 * 60;
const RESEND_COOLDOWN_SECONDS = 60; // One reset email per account per minute.

const tokenKey = (tokenHash: string) => `password-reset:token:${tokenHash}`; // token hash → user id
/** user id → hash of their latest token, so a new request invalidates the previous link. */
const userKey = (userId: string) => `password-reset:user:${userId}`;

@Injectable()
export class PasswordResetService {
  private readonly logger = Logger(PasswordResetService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly db: DbService,
    private readonly encryption: EncryptionService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    private readonly platformMail: PlatformMailService,
  ) {}

  async requestReset(email: string): Promise<void> {
    const [user] = await this.db.client
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.email, email.toLowerCase()));

    if (!user) return;

    const previous = await this.redis.get(userKey(user.id));
    if (previous) {
      const ttl = await this.redis.ttl(userKey(user.id));
      if (ttl > RESET_TTL_SECONDS - RESEND_COOLDOWN_SECONDS) {
        return;
      }
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.encryption.hash(token);
    const expiry = {
      expiration: { type: 'EX', value: RESET_TTL_SECONDS },
    } as const;

    const tx = this.redis.multi();
    if (previous) tx.del(tokenKey(previous));
    tx.set(tokenKey(tokenHash), user.id, expiry);
    tx.set(userKey(user.id), tokenHash, expiry);
    await tx.exec();

    this.platformMail
      .send(
        user.email,
        passwordResetEmail({
          name: user.name,
          resetUrl: `${Secrets.DASHBOARD_URL}/reset-password?token=${token}`,
        }),
      )
      .catch((error: unknown) =>
        this.logger.error(
          `Password reset email to ${user.email} failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }

  async reset(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.encryption.hash(token);
    const userId = await this.redis.getDel(tokenKey(tokenHash));

    if (!userId) {
      throw new CodedException(
        HttpStatus.BAD_REQUEST,
        'invalid_reset_token',
        'This reset link is invalid, expired, or already used',
      );
    }

    await this.redis.del(userKey(userId));

    await this.db.client
      .update(users)
      .set({ passwordHash: await this.passwords.hash(newPassword) })
      .where(eq(users.id, userId));

    await this.sessions.revokeAllForUser(userId);
  }
}
