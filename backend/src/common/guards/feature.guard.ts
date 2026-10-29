import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY } from '@src/common/decorators/requires-feature.decorator';
import { tenantOf } from '@src/common/decorators/request.decorators';
import { CodedException } from '@src/common/errors';
import type { EntitlementKey } from '@src/common/types';
import { EntitlementsService } from '@src/entitlements/entitlements.service';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<EntitlementKey | undefined>(
      FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!key) return true;

    const tenant = tenantOf(context.switchToHttp().getRequest());
    if ((await this.entitlements.get(tenant.orgId, key)) === true) {
      return true;
    }

    throw new CodedException(
      HttpStatus.FORBIDDEN,
      'feature_not_in_plan',
      `Your plan does not include ${key}`,
      { key },
    );
  }
}
