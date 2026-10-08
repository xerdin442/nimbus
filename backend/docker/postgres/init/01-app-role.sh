#!/bin/sh
# Runs once, when the postgres volume is first created.
# - nimbus_app: the role the API logs in as. Not the table owner, not a superuser, no BYPASSRLS,
#   so row-level security always applies to it. Table privileges are granted by migrations.
# - nimbus_test: separate database for the e2e (RLS isolation) suite.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$NIMBUS_APP_DB_PASSWORD" <<'EOSQL'
CREATE ROLE nimbus_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE nimbus_test;
EOSQL
