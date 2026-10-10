import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VERIFIED_FOR_LIVE_KEY } from '@src/common/decorators/verified-org.decorator';
import { CodedException } from '@src/common/errors';
import type { DashboardRequest } from '@src/common/types';

@Injectable()
export class OrgVerifiedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      VERIFIED_FOR_LIVE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<DashboardRequest>();

    if (request.livemode && !request.membership.isVerified) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        'org_not_verified',
        'Connect your live Paystack key and an email provider to use live mode',
      );
    }

    return true;
  }
}
