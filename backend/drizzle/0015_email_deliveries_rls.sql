-- Custom SQL migration file, put your code below! --
-- RLS for the customer email log. Helpers from 0001_rls_foundation.

-- Per mode: a test-mode request must never see a live booking's emails.
SELECT enable_tenant_mode_rls('email_deliveries');
