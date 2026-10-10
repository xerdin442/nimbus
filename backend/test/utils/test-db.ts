import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** Owner-role pool for the test database: migrates and resets it (bypasses RLS). */
export const createOwnerPool = () =>
  new Pool({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL });

export async function resetTestDatabase(pool: Pool): Promise<void> {
  const owner = drizzle(pool);
  await migrate(owner, { migrationsFolder: 'drizzle' });
  // organizations and users cascade to every other table.
  await owner.execute(sql`truncate table organizations, users cascade`);
}
