import { IntersectionType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Max,
  MaxLength,
} from 'class-validator';
import { ListArchivedQueryDto } from '@src/common/dto/archived-query.dto';
import { PaginationDto } from '@src/common/dto/pagination.dto';

export class ListMoviesQueryDto extends IntersectionType(
  PaginationDto,
  ListArchivedQueryDto,
) {}

export class CreateMovieDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  synopsis?: string;

  @IsInt()
  @IsPositive()
  @Max(600)
  runtimeMinutes: number;

  /** Free text so each country's rating system fits, e.g. "PG-13", "15", "18". */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  rating?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  language?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  genres?: string[];

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  posterUrl?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  trailerUrl?: string;
}

export class UpdateMovieDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  synopsis?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(600)
  runtimeMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  rating?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  language?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  genres?: string[];

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  posterUrl?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  trailerUrl?: string;
}
