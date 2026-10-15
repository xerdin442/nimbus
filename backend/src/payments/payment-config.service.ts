import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { DbService } from '@src/db/db.service';
import { paymentConfigs } from '@src/db/schema';
import type { PaymentConfig } from '@src/db/schema/types';
import type { PaymentConfigView, TenantContext } from '@src/common/types';
import type { ReconcilePaymentsJob } from '@src/common/types/job';
import { EncryptionService } from '@src/common/helpers';
import { CodedException } from '@src/common/errors';
import { Logger } from '@src/common/logger';
import { OrgVerificationService } from '@src/organizations/org-verification.service';
import { PaystackProvider } from './providers/paystack.provider';
import { PaymentProviderError } from './providers/payment-provider.interface';
import { PaymentGatewayService } from './payment-gateway.service';
import { PAYMENTS_QUEUE, RECONCILE_JOB } from '@src/common/types/constants';

/** Payments started this long before a key broke may have been paid while it was broken. */
const RECONCILE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PaymentConfigService {
  private readonly logger = Logger(PaymentConfigService.name);

  constructor(
    private readonly db: DbService,
    private readonly encryption: EncryptionService,
    private readonly paystack: PaystackProvider,
    private readonly verification: OrgVerificationService,
    private readonly gateway: PaymentGatewayService,
    @InjectQueue(PAYMENTS_QUEUE) private readonly queue: Queue,
  ) {}

  async get(ctx: TenantContext): Promise<PaymentConfigView | null> {
    const [config] = await this.db.withTenant(ctx, (tx) =>
      tx.select().from(paymentConfigs),
    );

    return config ? this.toView(config) : null;
  }

  async connect(
    ctx: TenantContext,
    secretKey: string,
  ): Promise<{ config: PaymentConfigView; isVerified: boolean }> {
    const expectedPrefix = ctx.livemode ? 'sk_live_' : 'sk_test_';

    if (!secretKey.startsWith(expectedPrefix)) {
      throw new CodedException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'key_mode_mismatch',
        `In ${ctx.livemode ? 'live' : 'test'} mode the key must start with ${expectedPrefix}`,
      );
    }

    try {
      await this.paystack.verifyCredentials(secretKey);
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        throw error.kind === 'auth'
          ? new CodedException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              'payment_connection_failed',
              error.message,
            )
          : new CodedException(
              HttpStatus.BAD_GATEWAY,
              'payment_provider_unavailable',
              `${error.message}. Try again shortly.`,
            );
      }
      throw error;
    }

    const values = {
      provider: 'paystack' as const,
      encryptedSecret: this.encryption.encrypt(secretKey),
      last4: secretKey.slice(-4),
      status: 'verified' as const,
      lastError: null,
      verifiedAt: new Date(),
      brokenAt: null,
    };

    const result = await this.db.withTenant(ctx, async (tx) => {
      const [previous] = await tx
        .select({
          status: paymentConfigs.status,
          brokenAt: paymentConfigs.brokenAt,
        })
        .from(paymentConfigs);

      const [config] = await tx
        .insert(paymentConfigs)
        .values({
          organizationId: ctx.orgId,
          livemode: ctx.livemode,
          ...values,
        })
        .onConflictDoUpdate({
          target: [paymentConfigs.organizationId, paymentConfigs.livemode],
          set: values,
        })
        .returning();

      // Only the live key counts toward verification; test mode is open from signup.
      const isVerified = ctx.livemode
        ? await this.verification.refresh(tx, ctx.orgId)
        : false;

      return { config: this.toView(config), isVerified, previous };
    });

    await this.gateway.invalidate(ctx);
    if (result.previous?.status === 'broken') {
      await this.reconcile(ctx, result.previous.brokenAt);
    }

    return { config: result.config, isVerified: result.isVerified };
  }

  private async reconcile(ctx: TenantContext, brokenAt: Date | null) {
    const since = new Date(
      (brokenAt ?? new Date()).getTime() - RECONCILE_LOOKBACK_MS,
    );
    const job: ReconcilePaymentsJob = { ...ctx, since: since.toISOString() };

    try {
      await this.queue.add(RECONCILE_JOB, job, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      });
    } catch (error) {
      this.logger.error(
        `Failed to queue payment reconciliation for org ${ctx.orgId}: ${String(error)}`,
      );
    }
  }

  private toView(config: PaymentConfig): PaymentConfigView {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { encryptedSecret, organizationId, ...view } = config;
    return view;
  }
}
