import { SetMetadata } from '@nestjs/common';
import type { EntitlementKey } from '@src/common/types';

export const FEATURE_KEY = 'requiredFeature';

export const RequiresFeature = (key: EntitlementKey) =>
  SetMetadata(FEATURE_KEY, key);
