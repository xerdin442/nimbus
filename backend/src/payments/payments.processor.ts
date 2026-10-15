import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type {
  ProcessPaymentEventJob,
  ReconcilePaymentsJob,
} from '@src/common/types/job';
import { PaymentsService } from './payments.service';
import { PaymentWebhooksService } from './payment-webhooks.service';
import {
  PAYMENTS_QUEUE,
  PROCESS_EVENT_JOB,
  RECONCILE_JOB,
} from '@src/common/types/constants';

@Processor(PAYMENTS_QUEUE)
export class PaymentsProcessor extends WorkerHost {
  constructor(
    private readonly webhooks: PaymentWebhooksService,
    private readonly payments: PaymentsService,
  ) {
    super();
  }

  async process(
    job: Job<ProcessPaymentEventJob | ReconcilePaymentsJob>,
  ): Promise<void> {
    switch (job.name) {
      case PROCESS_EVENT_JOB: {
        const { orgId, livemode, eventId } = job.data as ProcessPaymentEventJob;
        await this.webhooks.process({ orgId, livemode }, eventId);
        break;
      }
      case RECONCILE_JOB: {
        const { orgId, livemode, since } = job.data as ReconcilePaymentsJob;
        await this.payments.reconcile({ orgId, livemode }, new Date(since));
        break;
      }
    }
  }
}
