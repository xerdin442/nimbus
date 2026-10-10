import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { DbService } from '@src/db/db.service';
import { locations, organizations, webhookEndpoints } from '@src/db/schema';

/**
 * Proves the tenant/mode isolation guarantees against a real Postgres:
 * - data is seeded as the owner role (bypasses RLS),
 * - every assertion queries as nimbus_app through DbService (RLS applies).
 */
const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL as string;
const appUrl = process.env.TEST_DATABASE_URL as string;

/**
 * Drizzle wraps driver errors ("Failed query: ..."); the Postgres error is the cause.
 * 42501 = insufficient_privilege, raised for "new row violates row-level security policy".
 */
const expectRlsViolation = async (promise: Promise<unknown>) => {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  const cause = (error as { cause?: { code?: string; message?: string } })
    ?.cause;

  expect(cause?.code).toBe('42501');
  expect(cause?.message).toMatch(/row-level security/);
};

describe('RLS isolation (e2e)', () => {
  let ownerPool: Pool;
  let db: DbService;
  let orgA: string;
  let orgB: string;

  const asTenant = (orgId: string, livemode = true) => ({ orgId, livemode });

  beforeAll(async () => {
    ownerPool = new Pool({ connectionString: ownerUrl });
    const owner = drizzle(ownerPool);

    await migrate(owner, { migrationsFolder: 'drizzle' });
    await owner.execute(sql`truncate table organizations, users cascade`);

    const [a, b] = await owner
      .insert(organizations)
      .values([
        {
          name: 'Filmhouse',
          slug: 'filmhouse',
          country: 'NG',
          currency: 'NGN',
          notificationEmail: 'ops@filmhouse.test',
        },
        {
          name: 'Genesis',
          slug: 'genesis',
          country: 'NG',
          currency: 'NGN',
          notificationEmail: 'ops@genesis.test',
        },
      ])
      .returning({ id: organizations.id });
    orgA = a.id;
    orgB = b.id;

    const location = (organizationId: string, name: string) => ({
      organizationId,
      name,
      address: '1 Admiralty Way',
      city: 'Lagos',
      timezone: 'Africa/Lagos',
    });
    await owner
      .insert(locations)
      .values([
        location(orgA, 'Filmhouse Lekki'),
        location(orgA, 'Filmhouse Surulere'),
        location(orgB, 'Genesis Maryland'),
      ]);

    const endpoint = (
      organizationId: string,
      livemode: boolean,
      url: string,
    ) => ({
      organizationId,
      livemode,
      url,
      secret: 'whsec_test',
    });
    await owner
      .insert(webhookEndpoints)
      .values([
        endpoint(orgA, true, 'https://a.test/live'),
        endpoint(orgA, false, 'https://a.test/test'),
        endpoint(orgB, true, 'https://b.test/live'),
      ]);

    db = new DbService(appUrl);
  });

  afterAll(async () => {
    await db?.onModuleDestroy();
    await ownerPool?.end();
  });

  describe('app role', () => {
    it('is not a superuser, not the table owner, and cannot bypass RLS', async () => {
      const result = await db.client.execute(sql`
        select r.rolsuper, r.rolbypassrls,
               (select tableowner from pg_tables where tablename = 'locations') as owner
        from pg_roles r where r.rolname = current_user
      `);
      const row = result.rows[0] as {
        rolsuper: boolean;
        rolbypassrls: boolean;
        owner: string;
      };

      expect(row.rolsuper).toBe(false);
      expect(row.rolbypassrls).toBe(false);
      expect(row.owner).not.toBe('nimbus_app');
    });
  });

  describe('shared tables (tenant only)', () => {
    it("returns only the current org's rows", async () => {
      const rowsA = await db.withTenant(asTenant(orgA), (tx) =>
        tx.select().from(locations),
      );
      const rowsB = await db.withTenant(asTenant(orgB), (tx) =>
        tx.select().from(locations),
      );

      expect(rowsA.map((l) => l.name).sort()).toEqual([
        'Filmhouse Lekki',
        'Filmhouse Surulere',
      ]);
      expect(rowsB.map((l) => l.name)).toEqual(['Genesis Maryland']);
    });

    it('is visible in both modes', async () => {
      const live = await db.withTenant(asTenant(orgA, true), (tx) =>
        tx.select().from(locations),
      );
      const test = await db.withTenant(asTenant(orgA, false), (tx) =>
        tx.select().from(locations),
      );

      expect(live).toHaveLength(2);
      expect(test).toHaveLength(2);
    });

    it('fails closed with no tenant context: zero rows, not an error', async () => {
      const rows = await db.client.select().from(locations);

      expect(rows).toEqual([]);
    });

    it('fails closed on a pooled connection that previously ran withTenant', async () => {
      // One connection, so the second query reuses the connection the transaction used.
      // After a transaction-local set_config, the setting reads '' (not NULL) on that connection.
      const single = new DbService(appUrl, { max: 1 });

      try {
        await single.withTenant(asTenant(orgA), (tx) =>
          tx.select().from(locations),
        );
        const rows = await single.client.select().from(locations);

        expect(rows).toEqual([]);
      } finally {
        await single.onModuleDestroy();
      }
    });

    it('rejects inserting a row for another org (WITH CHECK)', async () => {
      await expectRlsViolation(
        db.withTenant(asTenant(orgA), (tx) =>
          tx.insert(locations).values({
            organizationId: orgB,
            name: 'Sneaky',
            address: 'x',
            city: 'x',
            timezone: 'Africa/Lagos',
          }),
        ),
      );
    });

    it("cannot update or delete another org's rows", async () => {
      const updated = await db.withTenant(asTenant(orgA), (tx) =>
        tx
          .update(locations)
          .set({ name: 'Hijacked' })
          .where(eq(locations.organizationId, orgB))
          .returning(),
      );
      const deleted = await db.withTenant(asTenant(orgA), (tx) =>
        tx
          .delete(locations)
          .where(eq(locations.organizationId, orgB))
          .returning(),
      );

      expect(updated).toEqual([]);
      expect(deleted).toEqual([]);

      const rowsB = await db.withTenant(asTenant(orgB), (tx) =>
        tx.select().from(locations),
      );
      expect(rowsB.map((l) => l.name)).toEqual(['Genesis Maryland']);
    });

    it('keeps concurrent transactions for different orgs separate', async () => {
      const runs = Array.from({ length: 20 }, (_, i) => {
        const orgId = i % 2 === 0 ? orgA : orgB;
        return db
          .withTenant(asTenant(orgId), (tx) => tx.select().from(locations))
          .then((rows) => ({ orgId, rows }));
      });

      for (const { orgId, rows } of await Promise.all(runs)) {
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.organizationId === orgId)).toBe(true);
      }
    });
  });

  describe('mode-scoped tables (tenant + mode)', () => {
    it('returns only rows for the current mode', async () => {
      const live = await db.withTenant(asTenant(orgA, true), (tx) =>
        tx.select().from(webhookEndpoints),
      );
      const test = await db.withTenant(asTenant(orgA, false), (tx) =>
        tx.select().from(webhookEndpoints),
      );

      expect(live.map((e) => e.url)).toEqual(['https://a.test/live']);
      expect(test.map((e) => e.url)).toEqual(['https://a.test/test']);
    });

    it("still isolates orgs: org B's live endpoint is invisible to org A", async () => {
      const live = await db.withTenant(asTenant(orgA, true), (tx) =>
        tx.select().from(webhookEndpoints),
      );

      expect(live.some((e) => e.url === 'https://b.test/live')).toBe(false);
    });

    it('rejects writing a test row from a live-mode transaction', async () => {
      await expectRlsViolation(
        db.withTenant(asTenant(orgA, true), (tx) =>
          tx.insert(webhookEndpoints).values({
            organizationId: orgA,
            livemode: false,
            url: 'https://a.test/sneaky',
            secret: 'whsec_test',
          }),
        ),
      );
    });
  });

  describe('schema guardrail', () => {
    /**
     * Tables that deliberately have no RLS: read by auth code and guards before a tenant context
     * exists. Adding a table here is a reviewed decision; forgetting RLS on a new table fails below.
     */
    const GLOBAL_TABLES = ['memberships', 'invitations', 'api_keys'];

    it('global tables are exactly the allowlisted ones', async () => {
      const result = await ownerPool.query<{ table_name: string }>(`
        select c.relname as table_name
        from information_schema.columns col
        join pg_class c on c.relname = col.table_name
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where col.table_schema = 'public' and col.column_name = 'organization_id'
          and c.relkind = 'r' and not c.relrowsecurity
        order by 1
      `);

      expect(result.rows.map((r) => r.table_name)).toEqual(
        [...GLOBAL_TABLES].sort(),
      );
    });

    it('every other table with organization_id has RLS enabled, forced, and a policy', async () => {
      const result = await ownerPool.query<{
        table_name: string;
        rls: boolean;
        forced: boolean;
        policies: number;
      }>(
        `
        select c.relname as table_name,
               c.relrowsecurity as rls,
               c.relforcerowsecurity as forced,
               (select count(*)::int from pg_policies p
                 where p.schemaname = 'public' and p.tablename = c.relname) as policies
        from information_schema.columns col
        join pg_class c on c.relname = col.table_name
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where col.table_schema = 'public' and col.column_name = 'organization_id'
          and c.relkind = 'r' and c.relname <> all($1::text[])
      `,
        [GLOBAL_TABLES],
      );

      expect(result.rows.length).toBeGreaterThan(0);
      for (const table of result.rows) {
        expect(table).toMatchObject({
          table_name: table.table_name,
          rls: true,
          forced: true,
        });
        expect(table.policies).toBeGreaterThan(0);
      }
    });

    it('every table with a livemode column has a policy that checks the mode', async () => {
      const result = await ownerPool.query<{
        table_name: string;
        checks_mode: boolean;
      }>(
        `
        select col.table_name,
               exists (
                 select 1 from pg_policies p
                 where p.schemaname = 'public' and p.tablename = col.table_name
                   and p.qual like '%app_livemode()%'
                   and p.with_check like '%app_livemode()%'
               ) as checks_mode
        from information_schema.columns col
        where col.table_schema = 'public' and col.column_name = 'livemode'
          and col.table_name <> all($1::text[])
      `,
        [GLOBAL_TABLES],
      );

      expect(result.rows.length).toBeGreaterThan(0);
      for (const table of result.rows) {
        expect(table).toEqual({
          table_name: table.table_name,
          checks_mode: true,
        });
      }
    });
  });
});
