import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '@src/common/dto/pagination.dto';
import { WEBHOOK_DELIVERY_STATUSES } from '@src/db/schema/types';
import type { DeliveryStatus } from '@src/db/schema/types';
import { WEBHOOK_EVENTS, type WebhookEventType } from '../webhook-events';

export class ListWebhookDeliveriesQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  endpointId?: string;

  @IsOptional()
  @IsIn(WEBHOOK_EVENTS)
  event?: WebhookEventType;

  @IsOptional()
  @IsIn(WEBHOOK_DELIVERY_STATUSES)
  status?: DeliveryStatus;
}
