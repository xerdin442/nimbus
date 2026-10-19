import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { paymentEvents } from '@src/db/schema';
import { Logger } from '@src/common/logger';
import type { PaystackEvent, TenantContext } from '@src/common/types';
import type { ProcessPaymentEventJob } from '@src/common/types/job';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentsService } from './payments.service';
import { toRefundStatus } from './providers/paystack.provider';
import { PAYMENTS_QUEUE, PROCESS_EVENT_JOB } from '@src/common/types/constants';

// Identify the events Nimbus acts on and their dedupe id
const identifyEvent = (
  payload: PaystackEvent,
): { eventId: string; reference: string } | null => {
  const { event, data } = payload;

  if (event === 'charge.success' && data?.id && data.reference) {
    return { eventId: String(data.id), reference: data.reference };
  }
  if (event?.startsWith('refund.') && data?.transaction_reference) {
    return {
      eventId: data.transaction_reference,
      reference: data.transaction_reference,
    };
  }
  return null;
};

@Injectable()
export class PaymentWebhooksService {
  private readonly logger = Logger(PaymentWebhooksService.name);

  constructor(
    private readonly db: DbService,
    private readonly gateway: PaymentGatewayService,
    private readonly payments: PaymentsService,
    @InjectQueue(PAYMENTS_QUEUE) private readonly queue: Queue,
  ) {}

  async receive(
    ctx: TenantContext,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    const secret = await this.gateway.webhookSecret(ctx);

    if (
      !secret ||
      !rawBody ||
      !signature ||
      !this.gateway.provider.verifyWebhookSignature(secret, rawBody, signature)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as PaystackEvent;
    const identity = identifyEvent(payload);
    if (!identity) {
      return; // An event Nimbus doesn't act on: acknowledged, not stored.
    }

    const id = await this.db.withTenant(ctx, async (tx) => {
      const [inserted] = await tx
        .insert(paymentEvents)
        .values({
          organizationId: ctx.orgId,
          livemode: ctx.livemode,
          provider: 'paystack',
          eventType: payload.event!,
          providerEventId: identity.eventId,
          reference: identity.reference,
          payload,
        })
        .onConflictDoNothing()
        .returning({ id: paymentEvents.id });

      if (inserted) return inserted.id;

      // A redelivery. If an earlier attempt stored it but never got it queued, queue it now.
      const [existing] = await tx
        .select({
          id: paymentEvents.id,
          processedAt: paymentEvents.processedAt,
        })
        .from(paymentEvents)
        .where(
          and(
            eq(paymentEvents.eventType, payload.event!),
            eq(paymentEvents.providerEventId, identity.eventId),
          ),
        );
      return existing && !existing.processedAt ? existing.id : null;
    });

    if (!id) return;

    const job: ProcessPaymentEventJob = { ...ctx, eventId: id };
    await this.queue.add(PROCESS_EVENT_JOB, job, {
      jobId: `event-${id}`,
      attempts: 8,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 1000,
    });
  }

  /** The `process-event` job: dispatches a stored payment event once, then marks it processed. */
  async process(ctx: TenantContext, eventId: string): Promise<void> {
    const [event] = await this.db.withTenant(ctx, (tx) =>
      tx.select().from(paymentEvents).where(eq(paymentEvents.id, eventId)),
    );

    if (!event || event.processedAt) return;

    const { data } = event.payload as PaystackEvent;

    if (event.eventType === 'charge.success' && data?.status === 'success') {
      await this.payments.confirmCharge(
        ctx,
        {
          status: 'success',
          transactionId: String(data.id),
          reference: data.reference!,
          amount: Number(data.amount),
          currency: data.currency!,
          paidAt: data.paid_at ? new Date(data.paid_at) : null,
        },
        true,
      );
    } else if (event.eventType.startsWith('refund.')) {
      await this.payments.applyRefundStatus(
        ctx,
        event.reference!,
        toRefundStatus(event.eventType.slice('refund.'.length)),
      );
    } else {
      this.logger.warn(`Unhandled payment event ${event.eventType}`);
    }

    await this.db.withTenant(ctx, (tx) =>
      tx
        .update(paymentEvents)
        .set({ processedAt: new Date() })
        .where(eq(paymentEvents.id, eventId)),
    );
  }
}
