import { Injectable } from '@nestjs/common';
import { payments } from '@src/db/schema';
import type { Payment } from '@src/db/schema/types';
import type {
  OfflinePayment,
  TenantContext,
  Transaction,
} from '@src/common/types';

@Injectable()
export class PaymentsService {
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
      })
      .returning();
    return recorded;
  }
}
