import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@src/common/logger';
import type {
  ReservationEvent,
  TicketCheckedInEvent,
} from '@src/common/types/events';
import {
  RESERVATION_CANCELLED,
  RESERVATION_CONFIRMED,
  RESERVATION_EXPIRED,
  RESERVATION_REFUNDED,
  TICKET_CHECKED_IN,
} from '@src/common/types/constants';
import { WebhooksService } from './webhooks.service';
import { WebhookEventType } from './webhook-events';

@Injectable()
export class WebhooksListener {
  private readonly logger = Logger(WebhooksListener.name);

  constructor(private readonly webhooks: WebhooksService) {}

  @OnEvent(RESERVATION_CONFIRMED)
  onReservationConfirmed(event: ReservationEvent): Promise<void> {
    return this.dispatch(
      event.orgId,
      event.livemode,
      event.reservationId,
      RESERVATION_CONFIRMED,
    );
  }

  @OnEvent(RESERVATION_CANCELLED)
  onReservationCancelled(event: ReservationEvent): Promise<void> {
    return this.dispatch(
      event.orgId,
      event.livemode,
      event.reservationId,
      RESERVATION_CANCELLED,
    );
  }

  @OnEvent(RESERVATION_EXPIRED)
  onReservationExpired(event: ReservationEvent): Promise<void> {
    return this.dispatch(
      event.orgId,
      event.livemode,
      event.reservationId,
      RESERVATION_EXPIRED,
    );
  }

  @OnEvent(RESERVATION_REFUNDED)
  onReservationRefunded(event: ReservationEvent): Promise<void> {
    return this.dispatch(
      event.orgId,
      event.livemode,
      event.reservationId,
      RESERVATION_REFUNDED,
    );
  }

  @OnEvent(TICKET_CHECKED_IN)
  onTicketCheckedIn(event: TicketCheckedInEvent): Promise<void> {
    return this.dispatch(
      event.orgId,
      event.livemode,
      event.ticketId,
      TICKET_CHECKED_IN,
    );
  }

  private async dispatch(
    orgId: string,
    livemode: boolean,
    entityId: string,
    event: WebhookEventType,
  ): Promise<void> {
    try {
      await this.webhooks.dispatch({ orgId, livemode }, event, entityId);
    } catch (error) {
      this.logger.error(
        `Failed to schedule webhook ${event} for ${entityId}: ${String(error)}`,
      );
    }
  }
}
