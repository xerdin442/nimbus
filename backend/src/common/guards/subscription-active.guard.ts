import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SUBSCRIPTION_REQUIRED_KEY } from '@src/common/decorators/requires-subscription.decorator';
import { tenantOf } from '@src/common/decorators/request.decorators';
import { CodedException } from '@src/common/errors';
import { SubscriptionsService } from '@src/billing/subscriptions.service';

@Injectable()
export class SubscriptionActiveGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      SUBSCRIPTION_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) return true;

    const tenant = tenantOf(context.switchToHttp().getRequest());
    if (
      !tenant.livemode ||
      (await this.subscriptions.canUseLive(tenant.orgId))
    ) {
      return true;
    }

    throw new CodedException(
      HttpStatus.PAYMENT_REQUIRED,
      'subscription_inactive',
      'An active subscription is required for live mode',
    );
  }
}
