import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, id, timestamps } from './columns';
import { organizationId } from './organizations';
import { locations } from './locations';
import { seatTypeEnum } from './enums';

/** Archived screens don't count toward `screens.max`. */
export const screens = pgTable(
  'screens',
  {
    id: id(),
    organizationId: organizationId(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    format: text('format'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('screens_location_id_idx').on(table.locationId)],
);

/**
 * Versioned: saving a layout inserts a new version and marks it current.
 * Showtimes reference the version they were published with, so editing a layout never breaks bookings.
 */
export const seatLayouts = pgTable(
  'seat_layouts',
  {
    id: id(),
    organizationId: organizationId(),
    screenId: uuid('screen_id')
      .notNull()
      .references(() => screens.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    rows: integer('rows').notNull(),
    columns: integer('columns').notNull(),
    isCurrent: boolean('is_current').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('seat_layouts_screen_id_version_unique').on(
      table.screenId,
      table.version,
    ),
    uniqueIndex('seat_layouts_one_current_per_screen')
      .on(table.screenId)
      .where(sql`${table.isCurrent}`),
  ],
);

/** A seat in a layout's grid. Grid cells with no seat are aisles/gaps. */
export const seats = pgTable(
  'seats',
  {
    id: id(),
    organizationId: organizationId(),
    layoutId: uuid('layout_id')
      .notNull()
      .references(() => seatLayouts.id, { onDelete: 'cascade' }),
    rowLabel: text('row_label').notNull(),
    number: integer('number').notNull(),
    gridRow: integer('grid_row').notNull(),
    gridColumn: integer('grid_column').notNull(),
    type: seatTypeEnum('type').notNull().default('standard'),
  },
  (table) => [
    uniqueIndex('seats_layout_id_label_unique').on(
      table.layoutId,
      table.rowLabel,
      table.number,
    ),
    uniqueIndex('seats_layout_id_cell_unique').on(
      table.layoutId,
      table.gridRow,
      table.gridColumn,
    ),
  ],
);
