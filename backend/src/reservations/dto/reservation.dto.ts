import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '@src/common/dto/pagination.dto';
import { RESERVATION_STATUSES } from '@src/db/schema/types';
import type { ReservationStatus } from '@src/db/schema/types';

export const MAX_SEATS_PER_RESERVATION = 10;

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

/** Physical buyers may not leave any details. */
export class BoxOfficeCustomerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

class SeatSelectionDto {
  @IsUUID()
  showtimeId: string;

  /** Showtime seat ids from the seat map. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SEATS_PER_RESERVATION)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  seatIds: string[];
}

export class CreateReservationDto extends SeatSelectionDto {
  @ValidateNested()
  @Type(() => CustomerDto)
  customer: CustomerDto;

  /** The org's own id for this customer, stored and returned untouched. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalCustomerId?: string;
}

export class BoxOfficeSaleDto extends SeatSelectionDto {
  @IsIn(['cash', 'pos'])
  method: 'cash' | 'pos';

  @IsOptional()
  @ValidateNested()
  @Type(() => BoxOfficeCustomerDto)
  customer?: BoxOfficeCustomerDto;
}

export class ListReservationsQueryDto extends PaginationDto {
  @IsOptional()
  @Transform(trimUpper)
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @Transform(trimLower)
  @IsString()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsUUID()
  showtimeId?: string;

  @IsOptional()
  @IsIn(RESERVATION_STATUSES)
  status?: ReservationStatus;
}
