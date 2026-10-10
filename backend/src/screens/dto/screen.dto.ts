import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SEAT_TYPES } from '@src/db/schema/types';
import type { SeatType } from '@src/db/schema/types';

export const MAX_GRID_ROWS = 50;
export const MAX_GRID_COLUMNS = 60;

export class CreateScreenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** e.g. "IMAX", "3D", "4DX". */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  format?: string;
}

export class UpdateScreenDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  format?: string;
}

export class SeatCellDto {
  @IsInt()
  @Min(0)
  row: number;

  @IsInt()
  @Min(0)
  column: number;

  @IsOptional()
  @IsIn(SEAT_TYPES)
  type?: SeatType;
}

/** The layout editor's grid: cells without a seat are aisles/gaps. */
export class SaveLayoutDto {
  @IsInt()
  @Min(1)
  @Max(MAX_GRID_ROWS)
  rows: number;

  @IsInt()
  @Min(1)
  @Max(MAX_GRID_COLUMNS)
  columns: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_GRID_ROWS * MAX_GRID_COLUMNS)
  @ValidateNested({ each: true })
  @Type(() => SeatCellDto)
  seats: SeatCellDto[];

  /** Letters never used as row labels. Defaults to I, O and Q; send [] for the full alphabet. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique((letter: string) => letter.toUpperCase())
  @Matches(/^[A-Za-z]$/, {
    each: true,
    message: 'skipRowLetters must contain single letters A-Z',
  })
  skipRowLetters?: string[];
}
