import { Injectable } from '@nestjs/common';
import { Secrets } from '@src/common/secrets';
import {
  PAYSTACK_API_URL,
  PaystackEnvelope,
  PaystackPlan,
  SyncedPlan,
} from '@src/common/types';
import { REQUEST_TIMEOUT_MS } from '@src/common/util';
import { PaymentProviderError } from '@src/payments/providers/payment-provider.interface';

/** Nimbus's own Paystack account, separate from the per-org keys used for ticket sales. */
@Injectable()
export class PaystackBillingClient {
  get configured(): boolean {
    return Boolean(Secrets.PAYSTACK_BILLING_SECRET_KEY);
  }

  async getPlan(planCode: string): Promise<SyncedPlan> {
    const secretKey = Secrets.PAYSTACK_BILLING_SECRET_KEY;
    if (!secretKey) {
      throw new PaymentProviderError(
        'auth',
        'PAYSTACK_BILLING_SECRET_KEY is not configured',
      );
    }

    let response: Response;
    try {
      response = await fetch(
        `${PAYSTACK_API_URL}/plan/${encodeURIComponent(planCode)}`,
        {
          headers: { authorization: `Bearer ${secretKey}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (error) {
      throw new PaymentProviderError(
        'unavailable',
        `Paystack request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const envelope = (await response
      .json()
      .catch(() => {})) as PaystackEnvelope<PaystackPlan>;
    const message =
      envelope.message ?? `Paystack returned HTTP ${response.status}`;

    if (response.status === 401 || response.status === 403) {
      throw new PaymentProviderError(
        'auth',
        'Paystack rejected the billing key',
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new PaymentProviderError('unavailable', message);
    }
    if (!response.ok || envelope.status === false || !envelope.data) {
      throw new PaymentProviderError('rejected', message);
    }

    return {
      name: envelope.data.name,
      planCode: envelope.data.plan_code,
      amount: envelope.data.amount,
      interval: envelope.data.interval,
      currency: envelope.data.currency,
    };
  }
}
