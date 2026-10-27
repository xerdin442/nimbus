import {
  ArrayMaxSize,
  IsDate,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '@src/common/dto/pagination.dto';
import {
  EMAIL_DELIVERY_STATUSES,
  EMAIL_TYPES,
  type EmailDeliveryStatus,
  type EmailType,
} from '@src/db/schema/types';

export class ListEmailDeliveriesQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(EMAIL_DELIVERY_STATUSES)
  status?: EmailDeliveryStatus;

  @IsOptional()
  @IsIn(EMAIL_TYPES)
  type?: EmailType;
}

export class RetryEmailDeliveriesDto {
  @IsOptional()
  @IsUUID('all', { each: true })
  @ArrayMaxSize(100)
  ids?: string[];

  @IsOptional()
  @IsIn(['failed'])
  status?: 'failed';

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  since?: Date;
}
