import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { BILLING_QUEUE, SYNC_PLANS_JOB } from '@src/common/types/constants';
import { PlanSyncService } from './plan-sync.service';

@Processor(BILLING_QUEUE)
export class BillingProcessor extends WorkerHost {
  constructor(private readonly planSync: PlanSyncService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === SYNC_PLANS_JOB) {
      await this.planSync.sync();
    }
  }
}
