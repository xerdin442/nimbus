import { Global, Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { BILLING_QUEUE, SYNC_PLANS_JOB } from '@src/common/types/constants';
import { NotificationsModule } from '@src/notifications/notifications.module';
import { OrganizationsModule } from '@src/organizations/organizations.module';
import { BillingController } from './controllers/dashboard/billing.controller';
import { BillingWebhookController } from './controllers/webhooks/billing-webhook.controller';
import { BillingOverviewService } from './billing-overview.service';
import { BillingService } from './billing.service';
import { BillingWebhooksService } from './billing-webhooks.service';
import { PaystackBillingClient } from './paystack-billing.client';
import { BillingProcessor } from './billing.processor';
import { PlanSyncService } from './plan-sync.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageService } from './usage.service';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: BILLING_QUEUE }),
    NotificationsModule,
    OrganizationsModule,
  ],
  controllers: [BillingController, BillingWebhookController],
  providers: [
    PaystackBillingClient,
    PlanSyncService,
    BillingProcessor,
    BillingService,
    BillingWebhooksService,
    SubscriptionsService,
    BillingOverviewService,
    UsageService,
  ],
  exports: [PaystackBillingClient, SubscriptionsService, UsageService],
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
