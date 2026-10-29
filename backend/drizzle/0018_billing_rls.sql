-- Billing tables. `plans` is global (read before any tenant context). `billing_events` is global too
-- (the webhook handler dedupes before it knows the org) and is allowlisted in the RLS test.
-- Subscriptions, overrides and usage are tenant-owned and shared across test/live modes.
SELECT enable_tenant_rls('subscriptions');
--> statement-breakpoint
SELECT enable_tenant_rls('entitlement_overrides');
--> statement-breakpoint
SELECT enable_tenant_rls('usage_counters');
