import { config } from 'dotenv';

config({ quiet: true });

/**
 * e2e suites run the real app against the test database. Secrets are read at import time, so the
 * env must be set before any app module is imported. Defaults cover CI, which has no .env.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.PLATFORM_MAIL_DRIVER = 'log';
process.env.EMAIL_ALERT_DELAY_MS = '3000';

const defaults: Record<string, string> = {
  PORT: '3000',
  REDIS_URL: 'redis://localhost:6380',
  RATE_LIMITING_PER_SECOND: '1000',
  RATE_LIMITING_PER_MINUTE: '10000',
  DASHBOARD_URL: 'http://localhost:5173',
  JWT_SECRET: 'e2e-jwt-secret',
  ENCRYPTION_KEY: 'e2e-encryption-key',
  RESEND_API_KEY: 're_e2e',
  PLATFORM_MAIL_FROM: 'Nimbus <no-reply@nimbus.test>',
  TICKET_SIGNING_SECRET: 'e2e-ticket-signing-secret',
  PAYSTACK_BILLING_SECRET_KEY: 'sk_test_billing_good',
  PAYSTACK_PLAN_BASIC_MONTHLY: 'PLN_basic_monthly_test',
  PAYSTACK_PLAN_BASIC_ANNUAL: 'PLN_basic_annual_test',
  PAYSTACK_PLAN_PRO_MONTHLY: 'PLN_pro_monthly_test',
  PAYSTACK_PLAN_PRO_ANNUAL: 'PLN_pro_annual_test',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}

// Redis database 1, apart from development's database 0: a running dev server's BullMQ workers
// would otherwise pick up the suites' jobs (and run them against the dev database).
const redisUrl = new URL(process.env.REDIS_URL!);
redisUrl.pathname = '/1';
process.env.REDIS_URL = redisUrl.toString();
