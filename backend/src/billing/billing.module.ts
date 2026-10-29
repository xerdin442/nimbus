import { Global, Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { BILLING_QUEUE, SYNC_PLANS_JOB } from '@src/common/types/constants';
import { BillingController } from './controllers/billing.controller';
import { BillingOverviewService } from './billing-overview.service';
import { PaystackBillingClient } from './paystack-billing.client';
import { BillingProcessor } from './billing.processor';
import { PlanSyncService } from './plan-sync.service';
import { SubscriptionsService } from './subscriptions.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: BILLING_QUEUE })],
  controllers: [BillingController],
  providers: [
    PaystackBillingClient,
    PlanSyncService,
    BillingProcessor,
    SubscriptionsService,
    BillingOverviewService,
  ],
  exports: [PaystackBillingClient, SubscriptionsService],
})
export class BillingModule implements OnModuleInit {
  constructor(@InjectQueue(BILLING_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      SYNC_PLANS_JOB,
      { every: 24 * 60 * 60 * 1000 },
      {
        name: SYNC_PLANS_JOB,
        data: {},
        opts: { removeOnComplete: true },
      },
    );
  }
}
