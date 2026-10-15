import {
  char,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, livemode, timestamps } from './columns';
import { organizationId } from './organizations';
import { users } from './users';
import { showtimes, showtimeSeats } from './showtimes';
import { reservationChannelEnum, reservationStatusEnum } from './enums';

export const reservations = pgTable(
  'reservations',
  {
    id: id(),
    organizationId: organizationId(),
    livemode: livemode(),
    /** Short code for lookups at the box office. */
    code: text('code').notNull(),
    /** Same mode as the reservation: see the (showtime_id, livemode) foreign key below. */
    showtimeId: uuid('showtime_id').notNull(),
    /**
     * The showtime seats bought or held. Kept after a hold is released, so a payment that lands
     * after expiry can try to claim the same seats again.
     */
    seatIds: uuid('seat_ids').array().notNull().default([]),
    /** The payment that confirmed it; a second successful payment is refunded as a duplicate. */
    paymentId: uuid('payment_id'),
    status: reservationStatusEnum('status').notNull().default('pending'),
    channel: reservationChannelEnum('channel').notNull(),
    customerName: text('customer_name'),
    customerEmail: text('customer_email'),
    customerPhone: text('customer_phone'),
    /** The org's own id for the customer, passed through untouched. */
    externalCustomerId: text('external_customer_id'),
    total: integer('total').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    /** Pending reservations only: when the held seats are released. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('reservations_organization_id_code_unique').on(
      table.organizationId,
      table.code,
    ),
    index('reservations_showtime_id_idx').on(table.showtimeId),
    index('reservations_customer_email_idx').on(table.customerEmail),
    foreignKey({
      name: 'reservations_showtime_id_livemode_showtimes_fk',
      columns: [table.showtimeId, table.livemode],
      foreignColumns: [showtimes.id, showtimes.livemode],
    }).onDelete('cascade'),
  ],
);

/** Per mode. Void once the reservation isn't confirmed or the showtime is cancelled. */
export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    organizationId: organizationId(),
    livemode: livemode(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    showtimeSeatId: uuid('showtime_seat_id')
      .notNull()
      .references(() => showtimeSeats.id, { onDelete: 'cascade' }),
    /** Typed in by staff when a QR can't be scanned. The QR carries a signed token instead. */
    code: text('code').notNull(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    checkedInByUserId: uuid('checked_in_by_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('tickets_organization_id_code_unique').on(
      table.organizationId,
      table.code,
    ),
    index('tickets_reservation_id_idx').on(table.reservationId),
    index('tickets_showtime_seat_id_idx').on(table.showtimeSeatId),
  ],
);
