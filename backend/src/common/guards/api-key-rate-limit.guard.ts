import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '@src/common/cache';
import { CodedException } from '@src/common/errors';
import type { ApiKeyRequest } from '@src/common/types';
import { EntitlementsService } from '@src/entitlements/entitlements.service';

@Injectable()
export class ApiKeyRateLimitGuard implements CanActivate {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { apiKey } = context.switchToHttp().getRequest<ApiKeyRequest>();
    if (!apiKey?.livemode) return true;

    const limit = await this.entitlements.get(
      apiKey.orgId,
      'api.rate_limit_per_sec',
    );
    const window = Math.floor(Date.now() / 1000);
    const key = `api-rate:${apiKey.id}:${window}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, 2);
    }

    if (count > limit) {
      throw new CodedException(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate_limit_exceeded',
        `Your plan allows ${limit} requests per second`,
        { limit },
      );
    }

    return true;
  }
}
