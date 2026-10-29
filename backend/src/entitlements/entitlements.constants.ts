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

export const PRO_ENTITLEMENTS = {
  'locations.max': 10,
  'screens.max': 50,
  'members.max': 25,
  'api_keys.live.max': 5,
  'webhook_endpoints.live.max': 3,
  'reports.export': true,
  'email.branding': true,
  tmdb_import: true,
  'api.rate_limit_per_sec': 50,
  'reports.history_days': 730,
  'activity_logs.retention_days': 365,
  'tickets.monthly': 50000,
  'tickets.hard_stop_pct': 20,
} as const;

/** The four public plans seeded into `plans`; their Paystack codes come from deployment env. */
export const PUBLIC_PLANS = [
  {
    key: 'basic_monthly',
    name: 'Basic monthly',
    tier: 'basic',
    interval: 'monthly',
    entitlements: BASIC_ENTITLEMENTS,
  },
  {
    key: 'basic_annual',
    name: 'Basic annual',
    tier: 'basic',
    interval: 'annually',
    entitlements: BASIC_ENTITLEMENTS,
  },
  {
    key: 'pro_monthly',
    name: 'Pro monthly',
    tier: 'pro',
    interval: 'monthly',
    entitlements: PRO_ENTITLEMENTS,
  },
  {
    key: 'pro_annual',
    name: 'Pro annual',
    tier: 'pro',
    interval: 'annually',
    entitlements: PRO_ENTITLEMENTS,
  },
] as const;

/**
 * Test-mode resources always use Basic plan limits.
 * Maps a test-mode resource to the Basic limit that regulates it.
 */
export const TEST_MODE_LIMITS = {
  'api_keys.test.max': BASIC_ENTITLEMENTS['api_keys.live.max'],
  'webhook_endpoints.test.max':
    BASIC_ENTITLEMENTS['webhook_endpoints.live.max'],
} as const;

export const ENTITLEMENTS_CACHE_TTL_SECONDS = 60;
