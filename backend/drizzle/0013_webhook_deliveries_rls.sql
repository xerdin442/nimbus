-- Custom SQL migration file, put your code below! --
-- RLS for the outgoing webhook delivery log. Helpers from 0001_rls_foundation.

-- Per mode: a test-mode request must never see a live webhook endpoint's deliveries.
SELECT enable_tenant_mode_rls('webhook_deliveries');
