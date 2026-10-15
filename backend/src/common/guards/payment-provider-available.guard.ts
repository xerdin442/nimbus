import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { tenantOf } from '@src/common/decorators/request.decorators';
import { PaymentGatewayService } from '@src/payments/payment-gateway.service';

@Injectable()
export class PaymentProviderAvailableGuard implements CanActivate {
  constructor(private readonly gateway: PaymentGatewayService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.gateway.assertAvailable(
      tenantOf(context.switchToHttp().getRequest()),
    );
    return true;
  }
}
