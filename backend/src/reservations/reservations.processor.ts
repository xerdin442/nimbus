import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type {
  ExpireReservationJob,
  RefundReservationJob,
} from '@src/common/types/job';
import { ReservationsService } from './reservations.service';
import {
  EXPIRE_JOB,
  REFUND_JOB,
  RESERVATIONS_QUEUE,
} from '@src/common/types/constants';

@Processor(RESERVATIONS_QUEUE)
export class ReservationsProcessor extends WorkerHost {
  constructor(private readonly reservations: ReservationsService) {
    super();
  }

  async process(
    job: Job<ExpireReservationJob | RefundReservationJob>,
  ): Promise<void> {
    const { orgId, livemode, reservationId } = job.data;

    switch (job.name) {
      case EXPIRE_JOB:
        await this.reservations.expire({ orgId, livemode }, reservationId);
        break;
      case REFUND_JOB:
        await this.reservations.refundAutomatically(
          { orgId, livemode },
          reservationId,
          (job.data as RefundReservationJob).reason,
        );
        break;
    }
  }
}
