import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ROLES } from '@src/db/schema/types';
import type { Role } from '@src/db/schema/types';
import { INVITABLE_ROLES, type InvitableRole } from '@src/common/types';

export class InviteMemberDto {
  @IsEmail()
  email: string;

  @IsIn(INVITABLE_ROLES)
  role: InvitableRole;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  locationIds?: string[];
}

export class UpdateMemberDto {
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  locationIds?: string[];
}
