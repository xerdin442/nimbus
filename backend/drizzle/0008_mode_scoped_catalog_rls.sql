-- Custom SQL migration file, put your code below! --
-- Movies and showtimes move from shared to per mode: something added in test mode never reaches a
-- live storefront. Helpers from 0001_rls_foundation.

-- ── Per mode: swap the tenant-only policy for the tenant + mode one ─────────────────────────────
DROP POLICY IF EXISTS tenant_isolation ON movies;
--> statement-breakpoint
SELECT enable_tenant_mode_rls('movies');
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON showtimes;
--> statement-breakpoint
SELECT enable_tenant_mode_rls('showtimes');
--> statement-breakpoint

-- ── No overlapping showtimes, within a mode ─────────────────────────────────────────────────────
-- A test showtime never takes a live slot (and vice versa), so overlaps are only checked between
-- showtimes of the same mode.
ALTER TABLE showtimes DROP CONSTRAINT showtimes_no_overlap;
--> statement-breakpoint
ALTER TABLE showtimes ADD CONSTRAINT showtimes_no_overlap
  EXCLUDE USING gist (screen_id WITH =, livemode WITH =, tstzrange(starts_at, cleanup_ends_at) WITH &&)
  WHERE (status <> 'cancelled');
