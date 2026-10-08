import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv';

dotenv.config();

const config = new ConfigService();

interface SecretsConfig {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  RATE_LIMITING_PER_SECOND: number;
  RATE_LIMITING_PER_MINUTE: number;
  DASHBOARD_URL: string;
}

function getString(key: string): string {
  return config.getOrThrow<string>(key);
}

function getNumber(key: string): number {
  return Number(config.getOrThrow<string>(key));
}

export const Secrets: SecretsConfig = {
  NODE_ENV: process.env.NODE_ENV as string,
  PORT: getNumber('PORT'),
  DATABASE_URL: getString('DATABASE_URL'),
  REDIS_URL: getString('REDIS_URL'),
  RATE_LIMITING_PER_SECOND: getNumber('RATE_LIMITING_PER_SECOND'),
  RATE_LIMITING_PER_MINUTE: getNumber('RATE_LIMITING_PER_MINUTE'),
  DASHBOARD_URL: getString('DASHBOARD_URL'),
};
