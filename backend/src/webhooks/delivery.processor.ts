import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { DeliverWebhookJob } from '@src/common/types/job';
import { WebhooksService } from './webhooks.service';
import { WEBHOOKS_QUEUE } from '@src/common/types/constants';

@Processor(WEBHOOKS_QUEUE)
export class DeliveryProcessor extends WorkerHost {
  constructor(private readonly webhooks: WebhooksService) {
    super();
  }

  async process(job: Job<DeliverWebhookJob>): Promise<void> {
    const { orgId, livemode, deliveryId } = job.data;
    await this.webhooks.deliver({ orgId, livemode }, deliveryId);
  }
}
