import {
  IsEmail,
  IsIn,
  IsISO31661Alpha2,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Currencies Paystack settles in. */
export const SUPPORTED_CURRENCIES = [
  'NGN',
  'GHS',
  'ZAR',
  'KES',
  'USD',
] as const;

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsISO31661Alpha2()
  country: string;

  @IsIn(SUPPORTED_CURRENCIES)
  currency: (typeof SUPPORTED_CURRENCIES)[number];
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
