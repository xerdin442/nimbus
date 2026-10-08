import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Migrations run as the owner role; the API itself connects as nimbus_app (see .env.example)
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL as string,
  },
  strict: true,
  verbose: true,
});
