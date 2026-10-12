import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Highest price per seat in minor units (i.e. ₦10,000,000.00). */
const MAX_PRICE = 1_000_000_000;

/** Price in minor units per seat type. Every seat type in the screen's layout needs a price. */
export class SeatPricesDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  standard?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  vip?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  couple?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  wheelchair?: number;
}

export class CreateShowtimeDto {
  @IsUUID()
  screenId: string;

  @IsUUID()
  movieId: string;

  /** ISO 8601 with an offset, e.g. 2026-10-12T19:30:00+01:00. */
  @Type(() => Date)
  @IsDate()
  startsAt: Date;

  @ValidateNested()
  @Type(() => SeatPricesDto)
  prices: SeatPricesDto;
}

/** Drafts only: a published showtime is unpublished first. */
export class UpdateShowtimeDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startsAt?: Date;

  @IsOptional()
  @ValidateNested()
  @Type(() => SeatPricesDto)
  prices?: SeatPricesDto;
}

/** A calendar day in the location's timezone. Defaults to the present day. */
export class LocalDateQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  date?: string;
}

export class ListShowtimesQueryDto extends LocalDateQueryDto {
  @IsUUID()
  locationId: string;
}
