/** In-process domain events (EventEmitter2). Each carries the mode, like every background job. */

interface BaseEvent {
  orgId: string;
  livemode: boolean;
}

export interface ShowtimeCancelledEvent extends BaseEvent {
  showtimeId: string;
}

export interface ReservationEvent extends BaseEvent {
  reservationId: string;
}

export interface PaymentSucceededEvent extends ReservationEvent {
  paymentId: string;
}

export interface RefundFailedEvent extends ReservationEvent {
  refundId: string;
}

export interface TicketCheckedInEvent extends BaseEvent {
  ticketId: string;
  checkedInByUserId: string;
}
