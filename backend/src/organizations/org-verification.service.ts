import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { mailConfigs, organizations, paymentConfigs } from '@src/db/schema';
import type { Transaction } from '@src/common/types';

/**
 * An org is verified once its LIVE payment config and its mail config are both `verified`.
 * Called in the same transaction that saves either config.
 */
@Injectable()
export class OrgVerificationService {
  async refresh(tx: Transaction, orgId: string): Promise<boolean> {
    const [mode] = await tx
      .execute<{ livemode: boolean | null }>(
        sql`select app_livemode() as livemode`,
      )
      .then((r) => r.rows);

    if (mode?.livemode !== true) {
      throw new Error(
        'OrgVerificationService.refresh needs a live-mode transaction',
      );
    }

    const [org] = await tx
      .select({ isVerified: organizations.isVerified })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update');

    if (org.isVerified) return true;

    const [payment] = await tx
      .select({ status: paymentConfigs.status })
      .from(paymentConfigs);
    const [mail] = await tx
      .select({ status: mailConfigs.status })
      .from(mailConfigs);

    if (payment?.status !== 'verified' || mail?.status !== 'verified') {
      return false;
    }

    await tx
      .update(organizations)
      .set({ isVerified: true, verifiedAt: new Date() })
      .where(eq(organizations.id, orgId));

    return true;
  }
}
