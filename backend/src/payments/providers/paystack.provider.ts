import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { RefundStatus } from '@src/db/schema/types';
import {
  InitializedPayment,
  InitializePaymentInput,
  PaymentProvider,
  PaymentProviderError,
  ProviderRefund,
  ProviderTransaction,
} from './payment-provider.interface';
import { REQUEST_TIMEOUT_MS } from '@src/common/util';
import { PAYSTACK_API_URL, PaystackEnvelope } from '@src/common/types';

export const toRefundStatus = (status: string): RefundStatus => {
  switch (status) {
    case 'processing':
    case 'processed':
    case 'failed':
      return status;
    case 'needs-attention':
      return 'needs_attention';
    default:
      return 'pending';
  }
};

@Injectable()
export class PaystackProvider implements PaymentProvider {
  async verifyCredentials(secretKey: string): Promise<void> {
    await this.request(secretKey, 'GET', '/transaction?perPage=1');
  }

  async initialize(
    secretKey: string,
    input: InitializePaymentInput,
  ): Promise<InitializedPayment> {
    const data = await this.request<{
      authorization_url: string;
      reference: string;
    }>(secretKey, 'POST', '/transaction/initialize', {
      email: input.email,
      amount: input.amount,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: JSON.stringify(input.metadata),
    });

    return {
      authorizationUrl: data.authorization_url,
      reference: data.reference,
    };
  }

  async verify(
    secretKey: string,
    reference: string,
  ): Promise<ProviderTransaction> {
    const data = await this.request<{
      id: number | string;
      status: string;
      reference: string;
      amount: number;
      currency: string;
      paid_at?: string | null;
    }>(
      secretKey,
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );

    return {
      status: data.status,
      transactionId: String(data.id),
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
      paidAt: data.paid_at ? new Date(data.paid_at) : null,
    };
  }

  async refund(secretKey: string, reference: string): Promise<ProviderRefund> {
    const data = await this.request<{ id: number | string; status: string }>(
      secretKey,
      'POST',
      '/refund',
      { transaction: reference },
    );

    return { refundId: String(data.id), status: toRefundStatus(data.status) };
  }

  verifyWebhookSignature(
    secretKey: string,
    rawBody: Buffer,
    signature: string,
  ): boolean {
    const expected = createHmac('sha512', secretKey).update(rawBody).digest();
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private async request<T = unknown>(
    secretKey: string,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${PAYSTACK_API_URL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${secretKey}`,
          ...(body && { 'content-type': 'application/json' }),
        },
        body: body && JSON.stringify(body),
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
      .catch(() => ({}))) as PaystackEnvelope<T>;
    const message =
      envelope.message ?? `Paystack returned HTTP ${response.status}`;

    if (response.status === 401 || response.status === 403) {
      throw new PaymentProviderError(
        'auth',
        'Paystack rejected the secret key',
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new PaymentProviderError('unavailable', message);
    }
    if (!response.ok || envelope.status === false) {
      throw new PaymentProviderError('rejected', message);
    }

    return envelope.data as T;
  }
}
