import { randomBytes, randomInt } from 'crypto';
import { ThrottlerModuleOptions, ThrottlerOptions } from '@nestjs/throttler';
import { Secrets } from '@src/common/secrets';
import type { Currency } from '@src/common/types';

export const randomAlphanumeric = (length: number): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);

  let result = '';
  for (let i = 0; i < length; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }

  return result;
};

/** No 0/O, 1/I/L or U: codes are read aloud and typed in by box-office staff. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Human-friendly code for reservations and tickets */
export const randomCode = (length: number): string =>
  Array.from(
    { length },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join('');

export const THROTTLER_SECONDS = 'Seconds';
export const THROTTLER_MINUTES = 'Minutes';

/** The webhook-verification payment per currency, in minor units */
export const VERIFICATION_AMOUNTS: Record<Currency, number> = {
  NGN: 50_000,
  GHS: 1_000,
  ZAR: 1_000,
  KES: 10_000,
  USD: 100,
};

export const applyThrottlerConfig = (): ThrottlerModuleOptions => {
  const throttles: ThrottlerOptions[] = [
    {
      name: THROTTLER_SECONDS,
      ttl: 1000,
      limit: Secrets.RATE_LIMITING_PER_SECOND,
    },
    {
      name: THROTTLER_MINUTES,
      ttl: 60000,
      limit: Secrets.RATE_LIMITING_PER_MINUTE,
    },
  ];

  return Secrets.NODE_ENV !== 'test' ? throttles : [];
};
