export const BASIC_ENTITLEMENTS = {
  'locations.max': 3,
  'screens.max': 15,
  'members.max': 5,
  'api_keys.live.max': 2,
  'webhook_endpoints.live.max': 1,
  'reports.export': false,
  'email.branding': false,
  tmdb_import: false,
  'api.rate_limit_per_sec': 10,
  'reports.history_days': 90,
  'activity_logs.retention_days': 30,
  'tickets.monthly': 5000,
  'tickets.hard_stop_pct': 8,
} as const;

/**
 * Test-mode resources always use Basic plan limits.
 * Maps a test-mode resource to the Basic limit that regulates it.
 */
export const TEST_MODE_LIMITS = {
  'api_keys.test.max': BASIC_ENTITLEMENTS['api_keys.live.max'],
  'webhook_endpoints.test.max':
    BASIC_ENTITLEMENTS['webhook_endpoints.live.max'],
} as const;
