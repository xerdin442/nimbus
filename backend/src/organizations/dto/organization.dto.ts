import { type Currency, SUPPORTED_CURRENCIES } from '@src/common/types';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsISO31661Alpha2,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsISO31661Alpha2()
  country: string;

  @IsIn(SUPPORTED_CURRENCIES)
  currency: Currency;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail()
  notificationEmail?: string;
}

export class UpdateOrgSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  adsMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  cleanupMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(30)
  holdMinutes?: number;
}
