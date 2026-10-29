import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { plans } from '@src/db/schema';
import { PLAN_INTERVALS, type PlanInterval } from '@src/db/schema/types';
import { Logger } from '@src/common/logger';
import { Secrets } from '@src/common/secrets';
import { PaystackBillingClient } from './paystack-billing.client';

const PLAN_CODES = [
  { key: 'basic_monthly', code: () => Secrets.PAYSTACK_PLAN_BASIC_MONTHLY },
  { key: 'basic_annual', code: () => Secrets.PAYSTACK_PLAN_BASIC_ANNUAL },
  { key: 'pro_monthly', code: () => Secrets.PAYSTACK_PLAN_PRO_MONTHLY },
  { key: 'pro_annual', code: () => Secrets.PAYSTACK_PLAN_PRO_ANNUAL },
];

@Injectable()
export class PlanSyncService implements OnApplicationBootstrap {
  private readonly logger = Logger(PlanSyncService.name);

  constructor(
    private readonly db: DbService,
    private readonly billingClient: PaystackBillingClient,
  ) {}

  onApplicationBootstrap(): void {
    void this.sync().catch((error: unknown) =>
      this.logger.error(`Billing plan bootstrap sync failed: ${String(error)}`),
    );
  }

  async sync(): Promise<void> {
    await this.db.client.transaction(async (tx) => {
      // Clear first so two plan codes swapped between environments don't trip the unique index.
      for (const { key } of PLAN_CODES) {
        await tx
          .update(plans)
          .set({ planCode: null })
          .where(eq(plans.key, key));
      }
      for (const { key, code } of PLAN_CODES) {
        await tx
          .update(plans)
          .set({ planCode: code() })
          .where(eq(plans.key, key));
      }
    });

    if (!this.billingClient.configured) {
      this.logger.warn(
        'PAYSTACK_BILLING_SECRET_KEY is not set; skipped plan price sync',
      );
      return;
    }

    const rows = await this.db.client
      .select()
      .from(plans)
      .where(and(isNotNull(plans.planCode), eq(plans.isActive, true)));

    for (const row of rows) {
      try {
        const remote = await this.billingClient.getPlan(row.planCode!);
        await this.db.client
          .update(plans)
          .set({
            ...remote,
            interval: PLAN_INTERVALS.includes(remote.interval as PlanInterval)
              ? (remote.interval as PlanInterval)
              : row.interval,
            syncedAt: new Date(),
          })
          .where(eq(plans.id, row.id));
      } catch (error) {
        this.logger.warn(
          `Failed to sync Paystack plan ${row.planCode}: ${String(error)}`,
        );
      }
    }
  }
}
