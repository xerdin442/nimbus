import { Throttle } from '@nestjs/throttler';
import { THROTTLER_MINUTES } from '@src/common/util';

/**
 * Per-IP limits for credential and account endpoints, stricter than the global ones.
 * They slow password guessing on login and email probing on signup.
 */
export const AUTH_RATE_LIMITS = {
  login: 10,
  signup: 5,
  acceptInvitation: 5,
  forgotPassword: 5,
  resetPassword: 5,
} as const;

export const AuthThrottle = (limitPerMinute: number) =>
  Throttle({ [THROTTLER_MINUTES]: { limit: limitPerMinute, ttl: 60_000 } });
