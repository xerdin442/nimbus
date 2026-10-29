import { SetMetadata } from '@nestjs/common';

export const SUBSCRIPTION_REQUIRED_KEY = 'subscriptionRequired';

/** Live-mode requests need an active subscription (test mode is never blocked by billing). */
export const RequiresSubscription = () =>
  SetMetadata(SUBSCRIPTION_REQUIRED_KEY, true);
