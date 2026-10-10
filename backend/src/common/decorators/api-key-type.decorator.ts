import { SetMetadata } from '@nestjs/common';
import type { ApiKeyType as KeyType } from '@src/db/schema/types';

export const API_KEY_TYPE_KEY = 'apiKeyType';

export const ApiKeyType = (type: KeyType) =>
  SetMetadata(API_KEY_TYPE_KEY, type);
