/** In-process domain events (EventEmitter2). Each carries the mode, like every background job. */

export interface ShowtimeCancelledEvent {
  orgId: string;
  livemode: boolean;
  showtimeId: string;
}

export interface ReservationEvent {
  orgId: string;
  livemode: boolean;
  reservationId: string;
}

export interface PaymentSucceededEvent extends ReservationEvent {
  paymentId: string;
}

export interface RefundFailedEvent extends ReservationEvent {
  refundId: string;
}
