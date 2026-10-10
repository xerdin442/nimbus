import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns';
import { organizationId } from './organizations';

export const movies = pgTable(
  'movies',
  {
    id: id(),
    organizationId: organizationId(),
    title: text('title').notNull(),
    synopsis: text('synopsis'),
    runtimeMinutes: integer('runtime_minutes').notNull(),
    rating: text('rating'),
    language: text('language'),
    genres: text('genres').array().notNull().default([]),
    posterUrl: text('poster_url'),
    trailerUrl: text('trailer_url'),
    tmdbId: integer('tmdb_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('movies_organization_id_idx').on(table.organizationId)],
);
