import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Secrets } from '@src/common/secrets';
import {
  CheckoutView,
  PAYSTACK_API_URL,
  PaystackEnvelope,
  PaystackInitializeData,
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

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const secretKey = Secrets.PAYSTACK_BILLING_SECRET_KEY;
    if (!secretKey || !signature) return false;

    const expected = createHmac('sha512', secretKey).update(rawBody).digest();
    const received = Buffer.from(signature, 'hex');

    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }

  async initialize(input: {
    email: string;
    planCode: string;
    reference: string;
    callbackUrl: string;
    metadata: Record<string, unknown>;
  }): Promise<CheckoutView> {
    const data = await this.request<PaystackInitializeData>(
      '/transaction/initialize',
      {
        method: 'POST',
        body: {
          email: input.email,
          plan: input.planCode,
          reference: input.reference,
          callback_url: input.callbackUrl,
          metadata: JSON.stringify(input.metadata),
        },
      },
    );

    return {
      authorizationUrl: data.authorization_url,
      reference: data.reference,
    };
  }

  async disableSubscription(
    subscriptionCode: string,
    emailToken: string,
  ): Promise<void> {
    await this.request<unknown>('/subscription/disable', {
      method: 'POST',
      body: { code: subscriptionCode, token: emailToken },
    });
  }

  /** Schedules a plan switch (downgrade) for `startDate` using the customer's saved authorization. */
  async createSubscription(input: {
    customer: string;
    planCode: string;
    authorization?: string | null;
    startDate: Date;
  }): Promise<void> {
    await this.request<unknown>('/subscription', {
      method: 'POST',
      body: {
        customer: input.customer,
        plan: input.planCode,
        ...(input.authorization && { authorization: input.authorization }),
        start_date: input.startDate.toISOString(),
      },
    });
  }

  async getManageLink(subscriptionCode: string): Promise<string> {
    const data = await this.request<{
      link: string;
    }>(`/subscription/${encodeURIComponent(subscriptionCode)}/manage/link`, {
      method: 'GET',
    });
    return data.link;
  }

  async sendManageEmail(subscriptionCode: string): Promise<void> {
    await this.request<unknown>(
      `/subscription/${encodeURIComponent(subscriptionCode)}/manage/email`,
      { method: 'POST' },
    );
  }

  async getPlan(planCode: string): Promise<SyncedPlan> {
    const data = await this.request<PaystackPlan>(
      `/plan/${encodeURIComponent(planCode)}`,
      { method: 'GET' },
    );

    return {
      name: data.name,
      planCode: data.plan_code,
      amount: data.amount,
      interval: data.interval,
      currency: data.currency,
    };
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: Record<string, unknown> },
  ): Promise<T> {
    const secretKey = Secrets.PAYSTACK_BILLING_SECRET_KEY;
    if (!secretKey) {
      throw new PaymentProviderError(
        'auth',
        'PAYSTACK_BILLING_SECRET_KEY is not configured',
      );
    }

    let response: Response;
    try {
      response = await fetch(`${PAYSTACK_API_URL}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${secretKey}`,
          ...(init.body && { 'content-type': 'application/json' }),
        },
        ...(init.body && { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new PaymentProviderError(
        'unavailable',
        `Paystack request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const envelope = (await response
      .json()
      .catch(() => {})) as PaystackEnvelope<T>;
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

    return envelope.data;
  }
}
