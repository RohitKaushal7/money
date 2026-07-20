#!/bin/sh
# Container entrypoint: migrate the durable SQLite stores, then serve.
#
# SQLite is the only migrated store (control.db + every users/<uid>/app.db). migrateAll is idempotent, so
# this is safe on every start; `set -e` makes a failed migration abort the boot instead of serving against
# an out-of-date schema. DuckDB is rebuilt, never migrated, so it is not touched here.
#
# We run the server from source with bun (not a bundle) so `@duckdb/node-api` resolves through the analytics
# package exactly as it does in dev — a bundle would hoist that native import to a path where it can't resolve.
set -e

echo "[entrypoint] applying SQLite migrations..."
bun scripts/migrate-db.ts

echo "[entrypoint] starting server..."
exec bun apps/server/src/index.ts
