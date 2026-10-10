import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv';

dotenv.config({ quiet: true });

const config = new ConfigService();

interface SecretsConfig {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  RATE_LIMITING_PER_SECOND: number;
  RATE_LIMITING_PER_MINUTE: number;
  DASHBOARD_URL: string;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  PLATFORM_MAIL_DRIVER: 'resend' | 'log';
  RESEND_API_KEY: string;
  PLATFORM_MAIL_FROM: string;
}

export const Secrets: SecretsConfig = {
  NODE_ENV: process.env.NODE_ENV as string,
  PORT: getNumber('PORT'),
  DATABASE_URL: getString('DATABASE_URL'),
  REDIS_URL: getString('REDIS_URL'),
  RATE_LIMITING_PER_SECOND: getNumber('RATE_LIMITING_PER_SECOND'),
  RATE_LIMITING_PER_MINUTE: getNumber('RATE_LIMITING_PER_MINUTE'),
  DASHBOARD_URL: getString('DASHBOARD_URL'),
  JWT_SECRET: getString('JWT_SECRET'),
  ENCRYPTION_KEY: getString('ENCRYPTION_KEY'),
  PLATFORM_MAIL_DRIVER: getOneOf('PLATFORM_MAIL_DRIVER', ['resend', 'log']),
  RESEND_API_KEY: getString('RESEND_API_KEY'),
  PLATFORM_MAIL_FROM: getString('PLATFORM_MAIL_FROM'),
};

function getString(key: string): string {
  return config.getOrThrow<string>(key);
}

function getNumber(key: string): number {
  return Number(config.getOrThrow<string>(key));
}

function getOneOf<T extends string>(key: string, allowed: readonly T[]): T {
  const value = getString(key);

  if (!allowed.includes(value as T)) {
    throw new Error(`${key} must be one of: ${allowed.join(', ')}`);
  }

  return value as T;
}
