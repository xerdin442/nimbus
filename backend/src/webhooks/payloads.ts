import { eq, inArray } from 'drizzle-orm';
import {
  movies,
  reservations,
  screens,
  seats,
  showtimeSeats,
  showtimes,
  tickets,
} from '@src/db/schema';
import type { Transaction } from '@src/common/types';
import { TICKET_CHECKED_IN } from '@src/common/types/constants';
import type { WebhookEventType, WebhookPayload } from './webhook-events';

const build = (
  event: WebhookEventType,
  livemode: boolean,
  data: unknown,
): WebhookPayload => ({ event, livemode, createdAt: new Date(), data });

/**
 * Payloads are built once, when the event happens, and stored on the delivery row. Every
 * retry posts the org the exact same bytes, even if the reservation has changed in between.
 */
export const buildWebhookPayload = async (
  tx: Transaction,
  event: WebhookEventType,
  livemode: boolean,
  entityId: string,
): Promise<WebhookPayload | null> => {
  if (event === TICKET_CHECKED_IN) {
    return ticketPayload(tx, event, livemode, entityId);
  }
  return reservationPayload(tx, event, livemode, entityId);
};

const reservationPayload = async (
  tx: Transaction,
  event: WebhookEventType,
  livemode: boolean,
  reservationId: string,
): Promise<WebhookPayload | null> => {
  const [row] = await tx
    .select({
      reservation: reservations,
      showtime: { id: showtimes.id, startsAt: showtimes.startsAt },
      movie: { id: movies.id, title: movies.title },
      screen: { id: screens.id, name: screens.name },
    })
    .from(reservations)
    .innerJoin(showtimes, eq(showtimes.id, reservations.showtimeId))
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .innerJoin(screens, eq(screens.id, showtimes.screenId))
    .where(eq(reservations.id, reservationId));

  if (!row) return null;

  // Seat labels come from the reservation's snapshot, not the inventory's current state:
  // by refund time (or expiry) the seats are back on sale and no longer reference it.
  const seatRows = await tx
    .select({
      rowLabel: seats.rowLabel,
      number: seats.number,
      type: seats.type,
    })
    .from(showtimeSeats)
    .innerJoin(seats, eq(seats.id, showtimeSeats.seatId))
    .where(inArray(showtimeSeats.id, row.reservation.seatIds));

  const ticketRows = await tx
    .select({
      id: tickets.id,
      code: tickets.code,
      rowLabel: seats.rowLabel,
      number: seats.number,
    })
    .from(tickets)
    .innerJoin(showtimeSeats, eq(showtimeSeats.id, tickets.showtimeSeatId))
    .innerJoin(seats, eq(seats.id, showtimeSeats.seatId))
    .where(eq(tickets.reservationId, reservationId));

  return build(event, livemode, {
    reservation: {
      id: row.reservation.id,
      code: row.reservation.code,
      status: row.reservation.status,
      channel: row.reservation.channel,
      total: row.reservation.total,
      currency: row.reservation.currency,
      customerName: row.reservation.customerName,
      customerEmail: row.reservation.customerEmail,
      customerPhone: row.reservation.customerPhone,
      externalCustomerId: row.reservation.externalCustomerId,
      showtime: row.showtime,
      movie: row.movie,
      screen: row.screen,
      seats: seatRows,
      tickets: ticketRows.map(({ id, code, rowLabel, number }) => ({
        id,
        code,
        seat: { rowLabel, number },
      })),
    },
  });
};

const ticketPayload = async (
  tx: Transaction,
  event: WebhookEventType,
  livemode: boolean,
  ticketId: string,
): Promise<WebhookPayload | null> => {
  const [row] = await tx
    .select({
      ticket: tickets,
      reservationCode: reservations.code,
      customerName: reservations.customerName,
      customerEmail: reservations.customerEmail,
      movieTitle: movies.title,
      screenName: screens.name,
    })
    .from(tickets)
    .innerJoin(reservations, eq(reservations.id, tickets.reservationId))
    .innerJoin(showtimes, eq(showtimes.id, reservations.showtimeId))
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .innerJoin(screens, eq(screens.id, showtimes.screenId))
    .where(eq(tickets.id, ticketId));

  if (!row) return null;

  return build(event, livemode, {
    ticket: {
      id: row.ticket.id,
      code: row.ticket.code,
      checkedInAt: row.ticket.checkedInAt,
    },
    reservation: {
      code: row.reservationCode,
      customerName: row.customerName,
      customerEmail: row.customerEmail,
    },
    showtime: {
      movieTitle: row.movieTitle,
      screenName: row.screenName,
    },
  });
};
