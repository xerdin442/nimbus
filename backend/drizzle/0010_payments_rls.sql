-- Custom SQL migration file, put your code below! --
-- RLS for Phase 3 payment tables. Helpers from 0001_rls_foundation.

-- Per mode: test refunds and webhook events never mix with live ones.
SELECT enable_tenant_mode_rls('refunds');
--> statement-breakpoint
SELECT enable_tenant_mode_rls('payment_events');
