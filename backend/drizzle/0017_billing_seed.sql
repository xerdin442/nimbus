-- Seed the four public plans. Paystack plan codes differ per environment, so they stay NULL here and
-- PlanSyncService fills them from PAYSTACK_PLAN_* environment variables at bootstrap.
INSERT INTO "plans" ("key", "name", "tier", "interval", "is_public", "entitlements")
VALUES
  (
    'basic_monthly',
    'Basic monthly',
    'basic',
    'monthly',
    true,
    '{"locations.max":3,"screens.max":15,"members.max":5,"api_keys.live.max":2,"webhook_endpoints.live.max":1,"reports.export":false,"email.branding":false,"tmdb_import":false,"api.rate_limit_per_sec":10,"reports.history_days":90,"activity_logs.retention_days":30,"tickets.monthly":5000,"tickets.hard_stop_pct":8}'::jsonb
  ),
  (
    'basic_annual',
    'Basic annual',
    'basic',
    'annually',
    true,
    '{"locations.max":3,"screens.max":15,"members.max":5,"api_keys.live.max":2,"webhook_endpoints.live.max":1,"reports.export":false,"email.branding":false,"tmdb_import":false,"api.rate_limit_per_sec":10,"reports.history_days":90,"activity_logs.retention_days":30,"tickets.monthly":5000,"tickets.hard_stop_pct":8}'::jsonb
  ),
  (
    'pro_monthly',
    'Pro monthly',
    'pro',
    'monthly',
    true,
    '{"locations.max":10,"screens.max":50,"members.max":25,"api_keys.live.max":5,"webhook_endpoints.live.max":3,"reports.export":true,"email.branding":true,"tmdb_import":true,"api.rate_limit_per_sec":50,"reports.history_days":730,"activity_logs.retention_days":365,"tickets.monthly":50000,"tickets.hard_stop_pct":20}'::jsonb
  ),
  (
    'pro_annual',
    'Pro annual',
    'pro',
    'annually',
    true,
    '{"locations.max":10,"screens.max":50,"members.max":25,"api_keys.live.max":5,"webhook_endpoints.live.max":3,"reports.export":true,"email.branding":true,"tmdb_import":true,"api.rate_limit_per_sec":50,"reports.history_days":730,"activity_logs.retention_days":365,"tickets.monthly":50000,"tickets.hard_stop_pct":20}'::jsonb
  )
ON CONFLICT ("key") DO NOTHING;
