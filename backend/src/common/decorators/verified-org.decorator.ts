import { SetMetadata } from '@nestjs/common';

export const VERIFIED_FOR_LIVE_KEY = 'verifiedOrgForLive';

/**
 * Marks a dashboard route that needs a verified org to access live mode.
 * Test mode is never blocked.
 */
export const VerifiedOrgForLive = () =>
  SetMetadata(VERIFIED_FOR_LIVE_KEY, true);
