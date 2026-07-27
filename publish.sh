#!/usr/bin/env bash
#
# Publish the app image to Docker Hub for self-hosters.
#
#   docker login          # once, interactively — this script never handles credentials
#   ./publish.sh          # build amd64 + arm64, tag :latest + :<git-sha>, push both
#
# This is NOT how the owner's server gets updated — deploy.sh ships a locally built image
# straight to cbs over SSH and never touches a registry. Publishing exists purely so the
# `docker compose pull rohitkaushal7/money:latest` in README.md is true.
#
# One manifest list covers amd64 (x86 servers, Fly) and arm64 (Apple Silicon, 64-bit
# Raspberry Pi OS), so `docker compose pull` resolves the right one with no tag juggling.
# No QEMU/binfmt needed: every RUN in the Dockerfile is pinned to $BUILDPLATFORM and the
# target-arch stage is RUN-free (see the comments there). 32-bit ARM is not shippable —
# DuckDB publishes no 32-bit binding.
#
# buildx pushes straight to the registry rather than building then pushing: a manifest list
# cannot be `--load`ed into the local image store, and publishing is registry-only anyway.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="${IMAGE:-rohitkaushal7/money}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

# Tag with the commit so a published image can always be traced back to source. A dirty
# tree makes that tag a lie, so say so rather than silently publishing something that
# does not exist in git.
SHA="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain)" ]; then
	echo "⚠️  working tree is dirty — :${SHA} will NOT match what is committed."
	read -rp "    publish anyway? [y/N] " reply
	[[ "$reply" =~ ^[Yy]$ ]] || { echo "aborted."; exit 1; }
fi

echo "==> Building + pushing ${IMAGE}:${SHA} and :latest for ${PLATFORMS}"
if ! docker buildx build \
	--platform "${PLATFORMS}" \
	-f apps/server/Dockerfile \
	-t "${IMAGE}:${SHA}" \
	-t "${IMAGE}:latest" \
	--push .; then
	echo
	echo "❌ build/push failed. If this is an auth error, run:  docker login" >&2
	echo "   (log in yourself — this script deliberately never handles credentials.)" >&2
	exit 1
fi

# Confirm the manifest list really carries every platform — a single-arch push would still
# look like a success above, and self-hosters on the missing arch are the ones who'd find out.
echo "==> Published platforms:"
docker buildx imagetools inspect "${IMAGE}:${SHA}" | grep -i platform

echo "==> Done. Self-hosters get it with:"
echo "      docker compose pull && docker compose up -d"
echo "    Pinned:  ${IMAGE}:${SHA}"
