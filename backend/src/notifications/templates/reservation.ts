import type { RefundReason } from '@src/db/schema/types';
import type { RenderedEmail } from '@src/common/types';
import { escapeHtml, formatMoney, layout } from './shared';

export interface ReservationEmailInput {
  orgName: string;
  code: string;
  customerName: string | null;
  movieTitle: string;
  screenName: string;
  locationName: string;
  startsAt: Date;
  timezone: string;
  seats: { rowLabel: string; number: number }[];
  tickets: { code: string; rowLabel: string; number: number }[];
  total: number;
  currency: string;
  refund?: { amount: number; currency: string; reason: RefundReason } | null;
}

export const formatShowtime = (startsAt: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(startsAt);

const REFUND_REASONS: Record<RefundReason, string> = {
  requested: 'the cinema refunded it over the counter',
  showtime_cancelled: 'the showtime was cancelled',
  payment_conflict: 'your seats were no longer available',
  duplicate_payment: 'you were charged twice',
};

const seatLabel = (seat: { rowLabel: string; number: number }): string =>
  `${seat.rowLabel}${seat.number}`;

const ticketList = (input: ReservationEmailInput): string =>
  input.tickets
    .map(
      (ticket) =>
        `<li>Seat ${escapeHtml(seatLabel(ticket))} &mdash; code <strong>${escapeHtml(ticket.code)}</strong></li>`,
    )
    .join('\n');

const showtimeLine = (input: ReservationEmailInput): string =>
  `<strong>${escapeHtml(input.movieTitle)}</strong> at ${escapeHtml(
    formatShowtime(input.startsAt, input.timezone),
  )}<br>
   ${escapeHtml(input.screenName)}, ${escapeHtml(input.locationName)}`;

const greeting = (input: ReservationEmailInput): string =>
  input.customerName ? `Hi ${escapeHtml(input.customerName)},` : 'Hello,';

export const confirmationEmail = (
  input: ReservationEmailInput,
): RenderedEmail => ({
  subject: `${input.orgName}: Your tickets for ${input.movieTitle}`,
  html: layout(
    `<p>${greeting(input)}</p>
     <p>Your booking is confirmed &mdash; your tickets are attached as QR codes, one image per ticket.</p>
     <p>${showtimeLine(input)}</p>
     <ul>${ticketList(input)}</ul>
     <p>Reservation code: <strong>${escapeHtml(input.code)}</strong> &mdash; total ${escapeHtml(formatMoney(input.total, input.currency))}.</p>
     <p>Show the QR images at the door. If scanning fails, staff can type in the ticket codes above.</p>`,
  ),
  text: `${greeting(input)}\n\nYour booking is confirmed — your tickets are attached as QR codes, one image per ticket.\n\n${input.movieTitle} at ${formatShowtime(input.startsAt, input.timezone)}\n${input.screenName}, ${input.locationName}\n\n${input.tickets
    .map((ticket) => `Seat ${seatLabel(ticket)} — code ${ticket.code}`)
    .join(
      '\n',
    )}\n\nReservation code: ${input.code} — total ${formatMoney(input.total, input.currency)}.\n\nShow the QR images at the door. If scanning fails, staff can type in the ticket codes above.`,
});

export const cancellationEmail = (
  input: ReservationEmailInput,
): RenderedEmail => ({
  subject: `${input.orgName}: Your reservation was cancelled`,
  html: layout(
    `<p>${greeting(input)}</p>
     <p>Your reservation for the showtime below was cancelled and the seats were released.</p>
     <p>${showtimeLine(input)}</p>
     <p>Reservation code: <strong>${escapeHtml(input.code)}</strong></p>`,
  ),
  text: `${greeting(input)}\n\nYour reservation for the showtime below was cancelled and the seats were released.\n\n${input.movieTitle} at ${formatShowtime(input.startsAt, input.timezone)}\n${input.screenName}, ${input.locationName}\n\nReservation code: ${input.code}`,
});

export const refundEmail = (input: ReservationEmailInput): RenderedEmail => {
  const refund = input.refund!;
  const reason = REFUND_REASONS[refund.reason];
  return {
    subject: `${input.orgName}: Refund for ${input.movieTitle}`,
    html: layout(
      `<p>${greeting(input)}</p>
       <p>Your reservation was refunded because ${escapeHtml(reason)}. ${escapeHtml(
         formatMoney(refund.amount, refund.currency),
       )} will be returned via your original payment method; banks can take a few days to process it.</p>
       <p>${showtimeLine(input)}</p>
       <p>Reservation code: <strong>${escapeHtml(input.code)}</strong></p>`,
    ),
    text: `${greeting(input)}\n\nYour reservation was refunded because ${reason}. ${formatMoney(refund.amount, refund.currency)} will be returned via your original payment method; banks can take a few days to process it.\n\n${input.movieTitle} at ${formatShowtime(input.startsAt, input.timezone)}\n${input.screenName}, ${input.locationName}\n\nReservation code: ${input.code}`,
  };
};
