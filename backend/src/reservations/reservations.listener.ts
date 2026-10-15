import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@src/common/logger';
import type {
  PaymentSucceededEvent,
  ShowtimeCancelledEvent,
} from '@src/common/types/events';
import { ReservationsService } from './reservations.service';
import {
  PAYMENT_SUCCEEDED,
  SHOWTIME_CANCELLED,
} from '@src/common/types/constants';

@Injectable()
export class ReservationsListener {
  private readonly logger = Logger(ReservationsListener.name);

  constructor(private readonly reservations: ReservationsService) {}

  /** If the payment webhook job fails and BullMQ retries it (settling is idempotent). */
  @OnEvent(PAYMENT_SUCCEEDED, { suppressErrors: false })
  async onPaymentSucceeded(event: PaymentSucceededEvent): Promise<void> {
    await this.reservations.settlePayment(
      { orgId: event.orgId, livemode: event.livemode },
      event.reservationId,
      event.paymentId,
    );
  }

  @OnEvent(SHOWTIME_CANCELLED)
  async onShowtimeCancelled(event: ShowtimeCancelledEvent): Promise<void> {
    try {
      await this.reservations.closeCancelledShowtime(
        { orgId: event.orgId, livemode: event.livemode },
        event.showtimeId,
      );
    } catch (error) {
      // Leftover holds still lapse at their expiry; nothing can be booked on a cancelled showtime.
      this.logger.error(
        `Failed to close sales for showtime ${event.showtimeId}: ${String(error)}`,
      );
    }
  }
}
