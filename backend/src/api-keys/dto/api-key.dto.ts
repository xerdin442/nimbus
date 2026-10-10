import { IsIn } from 'class-validator';
import { API_KEY_TYPES } from '@src/db/schema/types';
import type { ApiKeyType } from '@src/db/schema/types';

export class CreateApiKeyDto {
  @IsIn(API_KEY_TYPES)
  type: ApiKeyType;
}
