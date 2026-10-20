import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksService } from './webhooks.service';
import { EndpointsService } from './endpoints.service';
import { WebhooksListener } from './webhooks.listener';
import { DeliveryProcessor } from './delivery.processor';
import { WebhookEndpointsController } from './controllers/webhook-endpoints.controller';
import { WebhookDeliveriesController } from './controllers/webhook-deliveries.controller';
import { WEBHOOKS_QUEUE } from '@src/common/types/constants';

@Module({
  imports: [BullModule.registerQueue({ name: WEBHOOKS_QUEUE })],
  controllers: [WebhookEndpointsController, WebhookDeliveriesController],
  providers: [
    WebhooksService,
    EndpointsService,
    WebhooksListener,
    DeliveryProcessor,
  ],
})
export class WebhooksModule {}
