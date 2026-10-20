import { Controller, Get, Query } from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import { CurrentTenant } from '@src/common/decorators/request.decorators';
import type { TenantContext } from '@src/common/types';
import { WebhooksService } from '../webhooks.service';
import { ListWebhookDeliveriesQueryDto } from '../dto/webhook-delivery.dto';

@Dashboard('owner')
@Controller('dashboard/webhooks/deliveries')
export class WebhookDeliveriesController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListWebhookDeliveriesQueryDto,
  ) {
    return this.webhooks.list(tenant, query);
  }
}
