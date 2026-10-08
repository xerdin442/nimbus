/// <reference types="jest" />

import 'reflect-metadata';
import 'dotenv/config';

jest.mock('@src/common/secrets', () => ({
  Secrets: {
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'postgresql://nimbus_app:test@localhost:5433/nimbus_test',
    REDIS_URL: 'redis://:test-redis-password@localhost:6380',
    RATE_LIMITING_PER_SECOND: 100,
    RATE_LIMITING_PER_MINUTE: 1000,
    DASHBOARD_URL: 'http://localhost:5173',
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});
