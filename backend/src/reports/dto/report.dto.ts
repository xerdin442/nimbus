import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class ReportRangeDto {
  @IsUUID()
  locationId: string;

  @Matches(DATE_ONLY, { message: 'startDate must be YYYY-MM-DD' })
  startDate: string;

  @Matches(DATE_ONLY, { message: 'endDate must be YYYY-MM-DD' })
  endDate: string;
}

export class ListReportShowtimesQueryDto extends ReportRangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
