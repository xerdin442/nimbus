import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, isNull } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { apiKeys } from '@src/db/schema';
import { EncryptionService } from '@src/common/helpers';
import { API_KEY_TYPE_KEY } from '@src/common/decorators/api-key-type.decorator';
import { CodedException } from '@src/common/errors';
import { Logger } from '@src/common/logger';
import type { ApiKeyRequest } from '@src/common/types';
import type { ApiKeyType } from '@src/db/schema/types';

export const API_KEY_PATTERN = /^(pk|sk)_(test|live)_[a-z0-9]{32}$/;

const LAST_USED_WRITE_INTERVAL_MS = 60_000;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = Logger(ApiKeyGuard.name);

  constructor(
    private readonly db: DbService,
    private readonly encryption: EncryptionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const [scheme, key] = (request.headers.authorization ?? '').split(' ');

    if (scheme !== 'Bearer' || !key || !API_KEY_PATTERN.test(key)) {
      throw new UnauthorizedException('Missing or malformed API key');
    }

    const [row] = await this.db.client
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.keyHash, this.encryption.hash(key)),
          isNull(apiKeys.revokedAt),
        ),
      );

    if (!row) {
      throw new UnauthorizedException('Invalid API key');
    }

    const required = this.reflector.getAllAndOverride<ApiKeyType | undefined>(
      API_KEY_TYPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (required === 'secret' && row.type !== 'secret') {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        'secret_key_required',
        'This endpoint requires a secret key; never use it from a browser',
      );
    }

    request.apiKey = {
      id: row.id,
      orgId: row.organizationId,
      livemode: row.livemode,
      type: row.type,
    };

    this.touchLastUsed(row.id, row.lastUsedAt);

    return true;
  }

  private touchLastUsed(id: string, lastUsedAt: Date | null) {
    if (
      lastUsedAt &&
      Date.now() - lastUsedAt.getTime() < LAST_USED_WRITE_INTERVAL_MS
    ) {
      return;
    }

    this.db.client
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, id))
      .catch((error: unknown) =>
        this.logger.warn(
          `Failed to update api key last_used_at: ${String(error)}`,
        ),
      );
  }
}
