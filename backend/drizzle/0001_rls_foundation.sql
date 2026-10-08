-- Custom SQL migration file, put your code below! --
-- Row-level security foundation. See plan: "Tenant isolation — Postgres RLS" and "Test and live modes".

-- ── Tenant context readers ──────────────────────────────────────────────────────────────────────
-- DbService.withTenant() sets app.org_id / app.livemode with set_config(..., true) (transaction-local).
-- NULLIF matters: once a pooled connection has run such a transaction, the setting reads '' (not NULL)
-- afterwards. ''::uuid would raise an error; NULL makes every policy comparison false → zero rows.
CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_livemode() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.livemode', true), '')::boolean $$;
--> statement-breakpoint

-- ── Policy helpers (used by this and every later migration that adds a tenant table) ────────────
-- Shared across modes: tenant check only.
CREATE OR REPLACE FUNCTION enable_tenant_rls(tbl regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s
       USING (organization_id = app_org_id())
       WITH CHECK (organization_id = app_org_id())',
    tbl
  );
END $$;
--> statement-breakpoint
-- Separate per mode: tenant and mode check.
CREATE OR REPLACE FUNCTION enable_tenant_mode_rls(tbl regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_mode_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_mode_isolation ON %s
       USING (organization_id = app_org_id() AND livemode = app_livemode())
       WITH CHECK (organization_id = app_org_id() AND livemode = app_livemode())',
    tbl
  );
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION enable_tenant_rls(regclass), enable_tenant_mode_rls(regclass) FROM PUBLIC;
--> statement-breakpoint

-- ── App role ────────────────────────────────────────────────────────────────────────────────────
-- Locally the docker init script creates nimbus_app with a password. Elsewhere, create it here
-- without login; ops then grants LOGIN + password. It must never own tables or have BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nimbus_app') THEN
    CREATE ROLE nimbus_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO nimbus_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nimbus_app;
--> statement-breakpoint
-- Tables created by later migrations (run by this same owner role) get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nimbus_app;
--> statement-breakpoint

-- ── Policies ────────────────────────────────────────────────────────────────────────────────────
-- organizations is global (no RLS): it's read before any tenant context exists (auth, API keys).
SELECT enable_tenant_rls('locations');
--> statement-breakpoint
SELECT enable_tenant_mode_rls('webhook_endpoints');
