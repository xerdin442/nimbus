-- Custom SQL migration file, put your code below! --
-- Phase 2: RLS for booking tables and the no-overlap rule for showtimes. Helpers from 0001_rls_foundation.

-- ── No overlapping showtimes ────────────────────────────────────────────────────────────────────
-- Two non-cancelled showtimes on one screen can't share any instant of [starts_at, cleanup_ends_at).
-- cleanup_ends_at is stored (not computed here) because timestamptz + interval isn't immutable,
-- and exclusion constraint expressions must be. btree_gist lets gist compare screen_id with =.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE showtimes ADD CONSTRAINT showtimes_no_overlap
  EXCLUDE USING gist (screen_id WITH =, tstzrange(starts_at, cleanup_ends_at) WITH &&)
  WHERE (status <> 'cancelled');
--> statement-breakpoint
ALTER TABLE showtimes ADD CONSTRAINT showtimes_ends_after_start CHECK (starts_at < ends_at AND ends_at <= cleanup_ends_at);
--> statement-breakpoint

-- ── Shared across modes: tenant only ────────────────────────────────────────────────────────────
SELECT enable_tenant_rls('org_settings');
--> statement-breakpoint
SELECT enable_tenant_rls('showtimes');
--> statement-breakpoint

-- ── Per mode: a test-mode request never sees or touches live inventory, sales or tickets ────────
SELECT enable_tenant_mode_rls('showtime_seats');
--> statement-breakpoint
SELECT enable_tenant_mode_rls('reservations');
--> statement-breakpoint
SELECT enable_tenant_mode_rls('payments');
--> statement-breakpoint
SELECT enable_tenant_mode_rls('tickets');
--> statement-breakpoint
SELECT enable_tenant_mode_rls('idempotency_keys');
