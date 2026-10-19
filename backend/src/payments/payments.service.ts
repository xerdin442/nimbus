import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { paymentConfigs, payments, refunds } from '@src/db/schema';
import type { Payment, Refund, RefundStatus } from '@src/db/schema/types';
import { CodedException } from '@src/common/errors';
import { Logger } from '@src/common/logger';
import { randomAlphanumeric } from '@src/common/util';
import type {
  CheckoutView,
  OfflinePayment,
  RefundInput,
  RefundView,
  StartCheckoutInput,
  TenantContext,
  Transaction,
} from '@src/common/types';
import type {
  PaymentSucceededEvent,
  RefundFailedEvent,
} from '@src/common/types/events';
import { PaymentGatewayService } from './payment-gateway.service';
import type { ProviderTransaction } from './providers/payment-provider.interface';
import { PAYMENT_SUCCEEDED, REFUND_FAILED } from '@src/common/types/constants';

/** Final refund states never move, except `failed` → `pending` when the refund is retried. */
const FINAL_REFUND_STATUSES: RefundStatus[] = ['processed', 'failed'];

@Injectable()
export class PaymentsService {
  private readonly logger = Logger(PaymentsService.name);

  constructor(
    private readonly db: DbService,
    private readonly gateway: PaymentGatewayService,
    private readonly events: EventEmitter2,
  ) {}

  /** Record box-office ticket sales */
  async recordOffline(
    tx: Transaction,
    ctx: TenantContext,
    payment: OfflinePayment,
  ): Promise<Payment> {
    const [recorded] = await tx
      .insert(payments)
      .values({
        organizationId: ctx.orgId,
        livemode: ctx.livemode,
        reservationId: payment.reservationId,
        method: payment.method,
        amount: payment.amount,
        currency: payment.currency,
        status: 'succeeded',
        paidAt: new Date(),
      })
      .returning();
    return recorded;
  }

  async startCheckout(
    ctx: TenantContext,
    input: StartCheckoutInput,
  ): Promise<CheckoutView> {
    const reference = `nmb-${randomAlphanumeric(24)}`;

    const [payment] = await this.db.withTenant(ctx, (tx) =>
      tx
        .insert(payments)
        .values({
          organizationId: ctx.orgId,
          livemode: ctx.livemode,
          reservationId: input.reservationId,
          provider: 'paystack',
          method: 'online',
          reference,
          amount: input.amount,
          currency: input.currency,
          status: 'pending',
        })
        .returning({ id: payments.id }),
    );

    try {
      return await this.gateway.withSecret(ctx, (provider, secretKey) =>
        provider.initialize(secretKey, {
          email: input.email,
          amount: input.amount,
          currency: input.currency,
          reference,
          callbackUrl: input.callbackUrl,
          metadata: { ...input.metadata, paymentId: payment.id },
        }),
      );
    } catch (error) {
      await this.db.withTenant(ctx, (tx) =>
        tx
          .update(payments)
          .set({ status: 'failed' })
          .where(eq(payments.id, payment.id)),
      );
      throw error;
    }
  }

  /**
   * A transaction the provider reports as paid (signed webhook or verify). Marks the payment
   * succeeded, then tells reservations, which confirms, or refunds a late or duplicate payment.
   * Safe to repeat: an already-succeeded payment is announced again, and the listener is idempotent.
   *
   * A verification payment belongs to no reservation: instead of the event,
   * a webhook-sourced confirmation flips the mode's payment-config webhook flag.
   * Reconcile path only marks the money, it never flips the verification status.
   */
  async confirmCharge(
    ctx: TenantContext,
    transaction: ProviderTransaction,
    viaWebhook = false,
  ): Promise<void> {
    const payment = await this.db.withTenant(ctx, async (tx) => {
      const [found] = await tx
        .select()
        .from(payments)
        .where(eq(payments.reference, transaction.reference))
        .for('update');

      if (!found) {
        this.logger.warn(
          `Charge for unknown reference ${transaction.reference} (org ${ctx.orgId})`,
        );
        return null;
      }
      if (found.status === 'succeeded') return found;

      if (
        transaction.amount !== found.amount ||
        transaction.currency !== found.currency
      ) {
        this.logger.error(
          `Charge ${transaction.reference} paid ${transaction.amount} ${transaction.currency}, expected ${found.amount} ${found.currency}`,
        );
        await tx
          .update(payments)
          .set({ status: 'failed' })
          .where(eq(payments.id, found.id));
        return null;
      }

      const [paid] = await tx
        .update(payments)
        .set({
          status: 'succeeded',
          providerTransactionId: transaction.transactionId,
          paidAt: transaction.paidAt ?? new Date(),
        })
        .where(eq(payments.id, found.id))
        .returning();

      if (paid.method === 'verification' && viaWebhook) {
        await tx
          .update(paymentConfigs)
          .set({ isWebhookVerified: true, webhookVerifiedAt: new Date() })
          .where(
            and(
              eq(paymentConfigs.organizationId, ctx.orgId),
              eq(paymentConfigs.livemode, ctx.livemode),
            ),
          );
      }
      return paid;
    });

    if (!payment) return;

    if (payment.method === 'verification') {
      await this.gateway.invalidate(ctx);
      return;
    }

    const event: PaymentSucceededEvent = {
      ...ctx,
      paymentId: payment.id,
      reservationId: payment.reservationId!,
    };
    await this.events.emitAsync(PAYMENT_SUCCEEDED, event);
  }

  /**
   * Full refund of a succeeded payment, at most once: a payment that already has a refund
   * returns it (`created: false`) unless that refund failed, in which case it is retried.
   * Online payments are refunded through the provider; cash/POS refunds were handed back
   * at the counter, so they are `processed` at once.
   */
  async refund(
    ctx: TenantContext,
    input: RefundInput,
    tx?: Transaction,
  ): Promise<{ refund: Refund; created: boolean }> {
    const run = async (t: Transaction) => {
      const [payment] = await t
        .select()
        .from(payments)
        .where(eq(payments.id, input.paymentId))
        .for('update');

      if (payment?.status !== 'succeeded' || !payment.reservationId) {
        throw new CodedException(
          HttpStatus.CONFLICT,
          'payment_not_refundable',
          'Only a successful payment can be refunded',
        );
      }

      const [existing] = await t
        .select()
        .from(refunds)
        .where(eq(refunds.paymentId, payment.id));

      if (existing && existing.status !== 'failed') {
        return { refund: existing, created: false };
      }

      // Cash/POS: amount handed back at the counter, nothing to call.
      const provider =
        payment.method === 'online'
          ? await this.gateway.withSecret(ctx, (p, secretKey) =>
              p.refund(secretKey, payment.reference!),
            )
          : { refundId: null, status: 'processed' as const };

      const values = {
        status: provider.status,
        providerRefundId: provider.refundId,
        reason: input.reason,
        note: input.note ?? null,
        lastError: null,
        createdByUserId: input.userId ?? null,
      };

      const [refund] = await t
        .insert(refunds)
        .values({
          organizationId: ctx.orgId,
          livemode: ctx.livemode,
          paymentId: payment.id,
          reservationId: payment.reservationId,
          amount: payment.amount,
          currency: payment.currency,
          ...values,
        })
        .onConflictDoUpdate({ target: refunds.paymentId, set: values })
        .returning();

      return { refund, created: true };
    };

    return tx ? run(tx) : this.db.withTenant(ctx, run);
  }

  /** A refund webhook: moves the payment's refund along Paystack's lifecycle. */
  async applyRefundStatus(
    ctx: TenantContext,
    reference: string,
    status: RefundStatus,
  ): Promise<void> {
    const failed = await this.db.withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({ refund: refunds })
        .from(refunds)
        .innerJoin(payments, eq(payments.id, refunds.paymentId))
        .where(eq(payments.reference, reference))
        .for('update');

      if (!row) {
        this.logger.warn(`Refund event for unknown reference ${reference}`);
        return null;
      }
      const { refund } = row;
      if (
        refund.status === status ||
        FINAL_REFUND_STATUSES.includes(refund.status)
      ) {
        return null;
      }

      await tx.update(refunds).set({ status }).where(eq(refunds.id, refund.id));
      return status === 'failed' ? refund : null;
    });

    if (failed) {
      const event: RefundFailedEvent = {
        ...ctx,
        refundId: failed.id,
        reservationId: failed.reservationId,
      };
      await this.events.emitAsync(REFUND_FAILED, event);
    }
  }

  /**
   * After a broken key is reconnected: webhooks signed with a rotated key may have been rejected,
   * so pending online payments from around the break are checked with the provider directly.
   */
  async reconcile(ctx: TenantContext, since: Date): Promise<void> {
    const pending = await this.db.withTenant(ctx, (tx) =>
      tx
        .select({ reference: payments.reference })
        .from(payments)
        .where(
          and(
            inArray(payments.method, ['online', 'verification']),
            eq(payments.status, 'pending'),
            gte(payments.createdAt, since),
          ),
        ),
    );

    for (const { reference } of pending) {
      const transaction = await this.gateway.withSecret(
        ctx,
        (provider, secretKey) => provider.verify(secretKey, reference!),
      );

      if (transaction.status === 'success') {
        await this.confirmCharge(ctx, transaction);
      } else if (
        ['failed', 'abandoned', 'reversed'].includes(transaction.status)
      ) {
        await this.db.withTenant(ctx, (tx) =>
          tx
            .update(payments)
            .set({ status: 'failed' })
            .where(
              and(
                eq(payments.reference, reference!),
                eq(payments.status, 'pending'),
              ),
            ),
        );
      }
    }
  }

  async refundFor(
    tx: Transaction,
    reservation: { id: string; paymentId: string | null },
  ): Promise<RefundView | null> {
    const [refund] = await tx
      .select({
        id: refunds.id,
        status: refunds.status,
        reason: refunds.reason,
        amount: refunds.amount,
        currency: refunds.currency,
        createdAt: refunds.createdAt,
        updatedAt: refunds.updatedAt,
      })
      .from(refunds)
      .where(
        reservation.paymentId
          ? eq(refunds.paymentId, reservation.paymentId)
          : eq(refunds.reservationId, reservation.id),
      )
      .orderBy(desc(refunds.createdAt))
      .limit(1);
    return refund ?? null;
  }
}
