# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------------------------------------
# Multi-arch (linux/amd64 + linux/arm64) with ZERO emulation. Every RUN below is pinned to $BUILDPLATFORM,
# so it executes natively on the build host; the arm64 leg differs only in WHICH prebuilt native bindings get
# downloaded (see the deps stage). The one $TARGETPLATFORM stage has no RUN at all, so cross-building arm64
# on an x86 box needs no QEMU/binfmt — see publish.sh.
# 64-bit ARM only: DuckDB publishes no 32-bit ARM binding, so 32-bit Raspberry Pi OS can never be supported.
# ---------------------------------------------------------------------------------------------------------

# ---------------------------------------------------------------------------------------------------------
# Builder: full toolchain. Installs every workspace dep (dev + prod) and builds the web SPA. This whole
# stage is discarded — none of its ~900MB of dev tooling (vite/biome/turbo/tsc) reaches the shipped image.
# The SPA output is plain JS/CSS, i.e. architecture-independent, so this stage runs ONCE and every platform
# leg grafts the same dist.
# Pinned to the newest RELEASED bun (1.3.14). This used to track `canary`, because the lockfile had been
# written by a canary build as lockfileVersion 2, which released bun rejects outright — it warns
# "Ignoring lockfile" and then --frozen-lockfile fails. The lockfile is regenerated on 1.3.14 now
# (lockfileVersion 1), so nothing needs an unreleased toolchain. Keep this in step with
# `packageManager` in package.json and `bun-version` in .github/workflows/ci.yml.
# ---------------------------------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM oven/bun:1.3.14 AS builder
WORKDIR /app

# No runtime secrets are present during the build; env is validated for real at container start (see below).
ENV SKIP_ENV_VALIDATION=1
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked bun install

# Build the web SPA with a relative server URL so the bundle is origin-portable (single-origin deploy).
ARG VITE_SERVER_URL=/
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN cd apps/web && bun run build

# ---------------------------------------------------------------------------------------------------------
# Deps: the production node_modules for the TARGET architecture, resolved on the BUILD architecture. bun's
# `--os`/`--cpu` flags override how optional dependencies are filtered, so an x86 host downloads the
# linux-arm64 prebuilds of @duckdb/node-api and libsql without ever executing arm64 code. That is what keeps
# the arm64 build native and fast; running this install inside the arm64 runtime stage would demand QEMU.
#
# `--filter '!web'` excludes the web workspace: the server only serves web's pre-built static dist (grafted
# in below), so none of its deps are needed at runtime — not its runtime libs (react, recharts, lucide,
# base-ui) nor the build tooling they drag in transitively (vite/rolldown/esbuild/lightningcss/typescript/
# sharp). `--production` drops every workspace's devDependencies on top of that. Finally drop the musl
# variants of the two native deps we DO keep: the runtime below is glibc (Debian) on every architecture we
# ship, so *-musl bindings can never load and are pure dead weight.
#
# `sharing=locked` on the bun cache: the platform legs of a multi-arch build run concurrently, and they all
# land on this one build-host cache directory. Serialise them rather than race.
# ---------------------------------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM oven/bun:1.3.14 AS deps
WORKDIR /app
COPY . .

ARG TARGETARCH
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked <<-'SH'
	set -e
	# Docker's arch vocabulary is not bun's. Anything outside this list has no DuckDB prebuild, so fail
	# loudly here instead of shipping an image that dies on first query.
	case "$TARGETARCH" in
		amd64) BUN_CPU=x64 ;;
		arm64) BUN_CPU=arm64 ;;
		*) echo "unsupported TARGETARCH=$TARGETARCH (DuckDB ships x64/arm64 prebuilds only)" >&2; exit 1 ;;
	esac
	bun install --production --frozen-lockfile --filter '!web' --os=linux --cpu="$BUN_CPU"
	rm -rf \
		node_modules/.bun/@duckdb+node-bindings-linux-*-musl@* \
		node_modules/.bun/@libsql+linux-*-musl@*
SH

# ---------------------------------------------------------------------------------------------------------
# Runtime: slim bun (Debian, glibc — the @duckdb/node-api prebuilt binary needs glibc, so NOT alpine/musl).
# The only $TARGETPLATFORM stage, and deliberately RUN-free: it just grafts what the two native stages built.
# `deps` hands over the whole /app tree, not just node_modules — bun's isolated linker keeps real packages in
# node_modules/.bun and symlinks them into each workspace's own node_modules, so the tree has to travel
# together for those relative symlinks to resolve.
# Node is gone entirely; the compose healthcheck uses `bun -e fetch`. The server runs from SOURCE with bun —
# that resolves @duckdb/node-api through @money/analytics exactly as in dev (a tsdown bundle would hoist the
# native import to a path where it can't resolve). DATA_DIR and ./apps/web/dist are resolved relative to
# this WORKDIR (/app).
# ---------------------------------------------------------------------------------------------------------
FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app ./
COPY --from=builder /app/apps/web/dist ./apps/web/dist

EXPOSE 3000
CMD ["sh", "entrypoint.sh"]
