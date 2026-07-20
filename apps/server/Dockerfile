# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------------------------------------
# Builder: full toolchain. Installs every workspace dep (dev + prod) and builds the web SPA. This whole
# stage is discarded — none of its ~900MB of dev tooling (vite/biome/turbo/tsc) reaches the shipped image.
# `canary` is the only published bun image on 1.4.0 (matches packageManager: bun@1.4.0); the stable `:1` /
# `:latest` tags still ship 1.3.14, which can't read bun.lock's format and silently ignores the lockfile.
# ---------------------------------------------------------------------------------------------------------
FROM oven/bun:canary AS builder
WORKDIR /app

# No runtime secrets are present during the build; env is validated for real at container start (see below).
ENV SKIP_ENV_VALIDATION=1
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install

# Build the web SPA with a relative server URL so the bundle is origin-portable (single-origin deploy).
ARG VITE_SERVER_URL=/
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN cd apps/web && bun run build

# ---------------------------------------------------------------------------------------------------------
# Runtime: slim bun (Debian, glibc — the @duckdb/node-api prebuilt binary needs glibc, so NOT alpine/musl).
# Node is gone entirely; the compose healthcheck uses `bun -e fetch`. We reinstall PRODUCTION deps only, so
# the dev toolchain is dropped, then run the server from SOURCE with bun — that resolves @duckdb/node-api
# through @money/analytics exactly as in dev (a tsdown bundle would hoist the native import to a path where
# it can't resolve). DATA_DIR and ./apps/web/dist are resolved relative to this WORKDIR (/app).
# ---------------------------------------------------------------------------------------------------------
FROM oven/bun:canary-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Source tree (node_modules/dist excluded by .dockerignore), then a production install that ALSO excludes the
# `web` workspace: the server only serves web's pre-built static dist (grafted in below), so none of its deps
# are needed at runtime — not its runtime libs (react, recharts, lucide, base-ui) nor the build tooling they
# drag in transitively (vite/rolldown/esbuild/lightningcss/typescript/sharp). `--production` drops every
# workspace's devDependencies on top of that. Finally drop the musl variants of the two native deps we DO
# keep: this is a glibc (Debian) image, so the *-musl bindings can never load and are pure dead weight.
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache \
	bun install --production --frozen-lockfile --filter '!web' \
	&& rm -rf \
		node_modules/.bun/@duckdb+node-bindings-linux-x64-musl@* \
		node_modules/.bun/@libsql+linux-x64-musl@*

# Graft the pre-built SPA from the builder (dist is gitignored and excluded from the build context).
COPY --from=builder /app/apps/web/dist ./apps/web/dist

EXPOSE 3000
CMD ["sh", "entrypoint.sh"]
