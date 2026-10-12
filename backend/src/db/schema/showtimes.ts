import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, livemode, timestamps } from './columns';
import { organizationId } from './organizations';
import { locations } from './locations';
import { screens, seatLayouts, seats } from './screens';
import { movies } from './movies';
import { reservations } from './reservations';
import { showtimeSeatStatusEnum, showtimeStatusEnum } from './enums';
import type { SeatPrices } from './types';

export const showtimes = pgTable(
  'showtimes',
  {
    id: id(),
    organizationId: organizationId(),
    livemode: livemode(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    screenId: uuid('screen_id')
      .notNull()
      .references(() => screens.id, { onDelete: 'cascade' }),
    /** Same mode as the showtime: see the (movie_id, livemode) foreign key below. */
    movieId: uuid('movie_id').notNull(),
    /** The layout version whose seats are snapshotted on publish. */
    layoutId: uuid('layout_id')
      .notNull()
      .references(() => seatLayouts.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** start + ads + runtime. */
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** ends_at + cleanup: the screen is busy until then. */
    cleanupEndsAt: timestamp('cleanup_ends_at', {
      withTimezone: true,
    }).notNull(),
    status: showtimeStatusEnum('status').notNull().default('draft'),
    prices: jsonb('prices').$type<SeatPrices>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('showtimes_location_id_starts_at_idx').on(
      table.locationId,
      table.startsAt,
    ),
    index('showtimes_screen_id_idx').on(table.screenId),
    foreignKey({
      name: 'showtimes_movie_id_livemode_movies_fk',
      columns: [table.movieId, table.livemode],
      foreignColumns: [movies.id, movies.livemode],
    }).onDelete('restrict'),
    // Target of the (showtime_id, livemode) foreign keys on seat inventory and reservations.
    unique('showtimes_id_livemode_unique').on(table.id, table.livemode),
  ],
);

/**
 * Per mode: a showtime's seat inventory, created on publish in the showtime's mode. Holding a
 * seat is a conditional UPDATE on these rows, so Postgres row locks prevent double booking.
 */
export const showtimeSeats = pgTable(
  'showtime_seats',
  {
    id: id(),
    organizationId: organizationId(),
    livemode: livemode(),
    showtimeId: uuid('showtime_id').notNull(),
    seatId: uuid('seat_id')
      .notNull()
      .references(() => seats.id, { onDelete: 'restrict' }),
    status: showtimeSeatStatusEnum('status').notNull().default('available'),
    reservationId: uuid('reservation_id').references(() => reservations.id, {
      onDelete: 'set null',
    }),
    heldUntil: timestamp('held_until', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('showtime_seats_showtime_id_seat_id_livemode_unique').on(
      table.showtimeId,
      table.seatId,
      table.livemode,
    ),
    index('showtime_seats_reservation_id_idx').on(table.reservationId),
    foreignKey({
      name: 'showtime_seats_showtime_id_livemode_showtimes_fk',
      columns: [table.showtimeId, table.livemode],
      foreignColumns: [showtimes.id, showtimes.livemode],
    }).onDelete('cascade'),
  ],
);
