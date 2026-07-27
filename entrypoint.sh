#!/bin/sh
# Container entrypoint: provision the auth secret, migrate the durable SQLite stores, then serve.
#
# `@money/env/server` validates BETTER_AUTH_SECRET (min 32) and BETTER_AUTH_URL at import time, so a
# self-hoster would otherwise have to hand-write a .env before the first boot. We provision both here,
# before any `bun` process imports the env, so `docker compose up` works with an empty .env.
#
# SQLite is the only migrated store (control.db + every users/<uid>/app.db). migrateAll is idempotent, so
# this is safe on every start; `set -e` makes a failed migration abort the boot instead of serving against
# an out-of-date schema. DuckDB is rebuilt, never migrated, so it is not touched here.
#
# We run the server from source with bun (not a bundle) so `@duckdb/node-api` resolves through the analytics
# package exactly as it does in dev — a bundle would hoist that native import to a path where it can't resolve.
set -e

DATA_DIR="${DATA_DIR:-data}"

# Auto-provision the auth secret so an empty .env boots. Persisted under the data volume so sessions
# survive restarts and the secret rides along with the user's backup. Generated once, chmod 600. bun is
# guaranteed present in the image; openssl is not, so generate with node:crypto via bun.
if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
	mkdir -p "$DATA_DIR"
	SECRET_FILE="$DATA_DIR/auth-secret"
	if [ ! -f "$SECRET_FILE" ]; then
		bun -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))" > "$SECRET_FILE"
		chmod 600 "$SECRET_FILE"
		echo "[entrypoint] generated a new auth secret at $SECRET_FILE"
	fi
	BETTER_AUTH_SECRET="$(cat "$SECRET_FILE")"
	export BETTER_AUTH_SECRET
fi

# Default the auth URL so zero-config self-host works. Override in .env (or [env] in fly.toml) if you reach
# the app from any other origin (a LAN IP, a custom domain behind a reverse proxy).
#
# Fly.io injects FLY_APP_NAME into every Machine, and Fly Proxy always terminates TLS at
# https://<app>.fly.dev — so on Fly we can derive the correct HTTPS origin ourselves. Without this a Fly
# deploy would default to localhost and every session cookie would be rejected as cross-origin. Elsewhere
# (docker compose) FLY_APP_NAME is unset and we fall back to localhost exactly as before.
if [ -z "${BETTER_AUTH_URL:-}" ]; then
	if [ -n "${FLY_APP_NAME:-}" ]; then
		export BETTER_AUTH_URL="https://${FLY_APP_NAME}.fly.dev"
		echo "[entrypoint] BETTER_AUTH_URL unset; derived $BETTER_AUTH_URL from FLY_APP_NAME"
	else
		export BETTER_AUTH_URL="http://localhost:3000"
		echo "[entrypoint] BETTER_AUTH_URL unset; defaulting to http://localhost:3000"
	fi
fi

echo "[entrypoint] applying SQLite migrations..."
bun scripts/migrate-db.ts

echo "[entrypoint] starting server..."
exec bun apps/server/src/index.ts
