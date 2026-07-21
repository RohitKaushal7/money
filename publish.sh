#!/usr/bin/env bash
#
# Publish the app image to Docker Hub for self-hosters.
#
#   docker login          # once, interactively — this script never handles credentials
#   ./publish.sh          # build, tag :latest + :<git-sha>, push both
#
# This is NOT how the owner's server gets updated — deploy.sh ships a locally built image
# straight to cbs over SSH and never touches a registry. Publishing exists purely so the
# `docker compose pull rohitkaushal7/money:latest` in README.md is true.
#
# amd64/x86-64 only, which is what README.md claims. ARM (Raspberry Pi, Apple Silicon
# hosts) would need a `docker buildx build --platform linux/amd64,linux/arm64` variant;
# not built until someone actually wants it.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="${IMAGE:-rohitkaushal7/money}"

# Tag with the commit so a published image can always be traced back to source. A dirty
# tree makes that tag a lie, so say so rather than silently publishing something that
# does not exist in git.
SHA="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain)" ]; then
	echo "⚠️  working tree is dirty — :${SHA} will NOT match what is committed."
	read -rp "    publish anyway? [y/N] " reply
	[[ "$reply" =~ ^[Yy]$ ]] || { echo "aborted."; exit 1; }
fi

echo "==> Building ${IMAGE}:${SHA}"
docker build -f apps/server/Dockerfile -t "${IMAGE}:${SHA}" -t "${IMAGE}:latest" .

echo "==> Pushing ${IMAGE}:${SHA} and :latest"
if ! docker push "${IMAGE}:${SHA}"; then
	echo
	echo "❌ push failed. If this is an auth error, run:  docker login" >&2
	echo "   (log in yourself — this script deliberately never handles credentials.)" >&2
	exit 1
fi
docker push "${IMAGE}:latest"

echo "==> Done. Self-hosters get it with:"
echo "      docker compose pull && docker compose up -d"
echo "    Pinned:  ${IMAGE}:${SHA}"
