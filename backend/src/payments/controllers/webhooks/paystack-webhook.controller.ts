import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { THROTTLER_MINUTES, THROTTLER_SECONDS } from '@src/common/util';
import { PaymentWebhooksService } from '../../payment-webhooks.service';

const MODES = { test: 'test', live: 'live' } as const;

/**
 * Paystack → Nimbus, one URL per org and mode, each verified with that mode's secret key.
 * Not rate limited: Paystack controls the pace, and retries for 72h.
 */
@Controller('webhooks/paystack')
@SkipThrottle({ [THROTTLER_SECONDS]: true, [THROTTLER_MINUTES]: true })
export class PaystackWebhookController {
  constructor(private readonly webhooks: PaymentWebhooksService) {}

  @Post(':orgId/:mode')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('mode', new ParseEnumPipe(MODES)) mode: keyof typeof MODES,
    @Headers('x-paystack-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<void> {
    await this.webhooks.receive(
      { orgId, livemode: mode === 'live' },
      request.rawBody,
      signature,
    );
  }
}
