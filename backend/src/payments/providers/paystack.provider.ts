import { Injectable } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentProviderError,
} from './payment-provider.interface';

export const PAYSTACK_API_URL = 'https://api.paystack.co';
const TIMEOUT_MS = 10_000;

@Injectable()
export class PaystackProvider implements PaymentProvider {
  async verifyCredentials(secretKey: string): Promise<void> {
    let response: Response;

    try {
      response = await fetch(`${PAYSTACK_API_URL}/transaction?perPage=1`, {
        headers: { authorization: `Bearer ${secretKey}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new PaymentProviderError(
        'unavailable',
        `Paystack request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.ok) {
      return;
    }

    if (response.status === 401 || response.status === 403) {
      throw new PaymentProviderError(
        'auth',
        'Paystack rejected the secret key',
      );
    }

    throw new PaymentProviderError(
      'unavailable',
      `Paystack returned HTTP ${response.status}`,
    );
  }
}
