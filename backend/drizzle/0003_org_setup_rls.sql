-- Custom SQL migration file, put your code below! --
-- RLS for Phase 1 tenant tables. Helpers come from 0001_rls_foundation.
-- Global (no RLS, by design): users, memberships, invitations, refresh_tokens, api_keys —
-- they're read by auth code and guards before any tenant context exists.

-- Shared across modes: tenant only.
SELECT enable_tenant_rls('mail_configs');
--> statement-breakpoint
SELECT enable_tenant_rls('screens');
--> statement-breakpoint
SELECT enable_tenant_rls('seat_layouts');
--> statement-breakpoint
SELECT enable_tenant_rls('seats');
--> statement-breakpoint
SELECT enable_tenant_rls('movies');
--> statement-breakpoint

-- Per mode: a test-mode request can never read the live Paystack secret (and vice versa).
SELECT enable_tenant_mode_rls('payment_configs');
