import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type {
  ProcessBillingEventJob,
  SuspendSubscriptionJob,
} from '@src/common/types/job';
import {
  BILLING_QUEUE,
  PROCESS_BILLING_EVENT_JOB,
  SUSPEND_SUBSCRIPTION_JOB,
  SYNC_PLANS_JOB,
} from '@src/common/types/constants';
import { BillingWebhooksService } from './billing-webhooks.service';
import { PlanSyncService } from './plan-sync.service';

@Processor(BILLING_QUEUE)
export class BillingProcessor extends WorkerHost {
  constructor(
    private readonly planSync: PlanSyncService,
    private readonly webhooks: BillingWebhooksService,
  ) {
    super();
  }

  async process(
    job: Job<ProcessBillingEventJob | SuspendSubscriptionJob>,
  ): Promise<void> {
    switch (job.name) {
      case SYNC_PLANS_JOB:
        await this.planSync.run();
        break;
      case PROCESS_BILLING_EVENT_JOB: {
        const { eventId } = job.data as ProcessBillingEventJob;
        await this.webhooks.process(eventId);
        break;
      }
      case SUSPEND_SUBSCRIPTION_JOB: {
        const { orgId, subscriptionId } = job.data as SuspendSubscriptionJob;
        await this.webhooks.suspendIfStillPastDue(orgId, subscriptionId);
        break;
      }
    }
  }
}
