import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@src/common/logger';
import type {
  RefundFailedEvent,
  ReservationEvent,
} from '@src/common/types/events';
import {
  REFUND_FAILED,
  RESERVATION_CANCELLED,
  RESERVATION_CONFIRMED,
  RESERVATION_REFUNDED,
} from '@src/common/types/constants';
import type { EmailType } from '@src/db/schema/types';
import { EmailsService } from './emails.service';

@Injectable()
export class EmailsListener {
  private readonly logger = Logger(EmailsListener.name);

  constructor(private readonly emails: EmailsService) {}

  @OnEvent(RESERVATION_CONFIRMED)
  onReservationConfirmed(event: ReservationEvent): Promise<void> {
    return this.queue(event, 'confirmation');
  }

  @OnEvent(RESERVATION_CANCELLED)
  onReservationCancelled(event: ReservationEvent): Promise<void> {
    return this.queue(event, 'cancellation');
  }

  @OnEvent(RESERVATION_REFUNDED)
  onReservationRefunded(event: ReservationEvent): Promise<void> {
    return this.queue(event, 'refund');
  }

  @OnEvent(REFUND_FAILED)
  onRefundFailed(event: RefundFailedEvent): Promise<void> {
    return this.alert(event);
  }

  private async queue(event: ReservationEvent, type: EmailType): Promise<void> {
    try {
      await this.emails.queueFor(
        { orgId: event.orgId, livemode: event.livemode },
        event.reservationId,
        type,
      );
    } catch (error) {
      this.logger.error(
        `Failed to queue ${type} email for reservation ${event.reservationId}: ${String(error)}`,
      );
    }
  }

  private async alert(event: RefundFailedEvent): Promise<void> {
    try {
      await this.emails.alertRefundFailed(
        { orgId: event.orgId, livemode: event.livemode },
        event.refundId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send refund-failed alert for refund ${event.refundId}: ${String(error)}`,
      );
    }
  }
}
