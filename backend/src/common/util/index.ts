import { randomBytes } from 'crypto';
import { ThrottlerModuleOptions, ThrottlerOptions } from '@nestjs/throttler';
import { Secrets } from '@src/common/secrets';

export const randomAlphanumeric = (length: number): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);

  let result = '';
  for (let i = 0; i < length; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }

  return result;
};

export const THROTTLER_SECONDS = 'Seconds';
export const THROTTLER_MINUTES = 'Minutes';

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
