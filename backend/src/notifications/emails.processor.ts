import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import type { SendAlertJob, SendEmailJob } from '@src/common/types/job';
import { EmailsService } from './emails.service';
import { EMAILS_QUEUE, SEND_ALERT_JOB } from '@src/common/types/constants';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '@src/common/cache';
import type { RedisClientType } from 'redis';
import { PlatformMailService } from './platform-mail.service';
import { RenderedEmail } from '@src/common/types';
import { deliveryFailedAlertEmail, refundFailedAlertEmail } from './templates';

// The limiter keeps bulk retries under the provider's rate limits.
@Processor(EMAILS_QUEUE, { limiter: { max: 2, duration: 1000 } })
export class EmailProcessor extends WorkerHost {
  constructor(
    private readonly emails: EmailsService,
    private readonly platformMail: PlatformMailService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === SEND_ALERT_JOB) {
      return this.sendAlert(job.data as SendAlertJob);
    }

    const { orgId, livemode, deliveryId } = job.data as SendEmailJob;
    try {
      await this.emails.send({ orgId, livemode }, deliveryId);
    } catch (error) {
      // On the last attempt (the single automatic retry spent, or a permanent failure)
      // alert the org; the throttled alert sends at most one email per hour.
      const willRetry =
        job.attemptsMade + 1 < (job.opts.attempts ?? 1) &&
        !(error instanceof UnrecoverableError);
      if (!willRetry) {
        await this.emails
          .alertDeliveryFailure({ orgId, livemode }, deliveryId)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  private async sendAlert(data: SendAlertJob) {
    const {
      key,
      kind,
      orgName,
      to,
      amount,
      currency,
      since,
      failureReason,
      reservationCode,
    } = data;

    let email: RenderedEmail | null;

    if (kind === 'email-delivery-failure') {
      const count = await this.redis.get(key);
      if (!count || !since || !failureReason) return;

      email = deliveryFailedAlertEmail({
        orgName,
        since: new Date(since),
        failureReason,
        failedCount: Number(count),
      });
    } else {
      if (!amount || !currency || !reservationCode) return;

      email = refundFailedAlertEmail({
        amount,
        currency,
        orgName,
        reservationCode,
      });
    }

    await this.platformMail.send(to, email);
    await this.redis.del(key);
  }
}
