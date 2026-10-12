import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { ExpireReservationJob } from '@src/common/types';
import {
  RESERVATIONS_QUEUE,
  ReservationsService,
} from './reservations.service';

@Processor(RESERVATIONS_QUEUE)
export class ReservationExpiryProcessor extends WorkerHost {
  constructor(private readonly reservations: ReservationsService) {
    super();
  }

  async process(job: Job<ExpireReservationJob>): Promise<void> {
    const { orgId, livemode, reservationId } = job.data;
    await this.reservations.expire({ orgId, livemode }, reservationId);
  }
}
