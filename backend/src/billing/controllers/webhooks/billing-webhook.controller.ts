import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { THROTTLER_MINUTES, THROTTLER_SECONDS } from '@src/common/util';
import { BillingWebhooksService } from '../../billing-webhooks.service';

/** Paystack -> Nimbus for the platform subscription account, verified with the billing secret. */
@Controller('webhooks/billing/paystack')
@SkipThrottle({ [THROTTLER_SECONDS]: true, [THROTTLER_MINUTES]: true })
export class BillingWebhookController {
  constructor(private readonly webhooks: BillingWebhooksService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Headers('x-paystack-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<void> {
    await this.webhooks.receive(request.rawBody, signature);
  }
}
