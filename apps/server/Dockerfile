FROM node:24-slim AS base
# Bun is the runtime (matches dev, and resolves the @duckdb/node-api native dep through the analytics
# package). Node stays only so the compose healthcheck's `node -e fetch` has an interpreter. `canary` is the
# only published image on the current bun (1.4.0, matching packageManager: bun@1.4.0); the stable `:1` /
# `:latest` tags still ship 1.3.14, which can't read bun.lock's format and silently ignores the lockfile.
COPY --from=oven/bun:canary /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

# Install all workspace deps (cached). Skip env validation during the build — no runtime secrets present.
ENV SKIP_ENV_VALIDATION=1
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install

# Build the web SPA with a relative server URL so the bundle is origin-portable (single-origin deploy).
ARG VITE_SERVER_URL=/
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN cd apps/web && bun run build

# Runtime: validate env for real (secrets arrive from compose), run production, migrate-then-serve from the
# repo root — see entrypoint.sh. We run the server from source (not a bundle) so the native DuckDB import
# resolves exactly as in dev. DATA_DIR and ./apps/web/dist are resolved relative to this WORKDIR (/app).
ENV SKIP_ENV_VALIDATION=
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "entrypoint.sh"]
