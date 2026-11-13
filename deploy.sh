#!/usr/bin/env bash
#
# Manual deploy: ship the committed source to the server over SSH, build the image THERE, and restart. No
# registry, no CI, and no image tarball crossing the network — only the source (a few MB) travels, and the
# server builds natively for its own architecture.
#
#   REMOTE_HOST=myserver ./deploy.sh
#
# What ships is `git archive HEAD`: tracked files only, so data/, .env and anything else gitignored can never
# leave this machine. Uncommitted edits to tracked files are refused rather than silently left out.
#
# Most people should not need this: `docker compose pull` off the published image (see README) is the
# supported path. This exists for building and running your own revision on your own box.
#
# Prerequisites on the server, one-time:
#   - Docker with BuildKit (any current Docker), and a reverse proxy forwarding your HTTPS host to :3000
#   - <REMOTE_DIR>/.env created from .env.example (deploy.sh rsyncs the template and refuses to start without it)
set -euo pipefail
cd "$(dirname "$0")"

# Override both from the environment; an SSH host alias (see ~/.ssh/config) is the tidiest REMOTE_HOST.
REMOTE_HOST="${REMOTE_HOST:?set REMOTE_HOST to your server, e.g. REMOTE_HOST=myserver ./deploy.sh}"
REMOTE_DIR="${REMOTE_DIR:-apps/money}"   # relative to the remote home (root -> /root/apps/money)
IMAGE="money:latest"

if ! git diff --quiet HEAD --; then
  echo "ERROR: tracked files have uncommitted changes. Commit them first — deploy ships HEAD only." >&2
  exit 1
fi
REV="$(git describe --tags --always)"

echo "==> Shipping the source of ${REV} to ${REMOTE_HOST}:${REMOTE_DIR}/src ..."
ssh "${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR} && rm -rf ${REMOTE_DIR}/src && mkdir ${REMOTE_DIR}/src"
git archive --format=tar HEAD | ssh "${REMOTE_HOST}" "tar -x -C ${REMOTE_DIR}/src"
rsync -avz docker-compose.yml .env.example "${REMOTE_HOST}:${REMOTE_DIR}/"

echo "==> Building ${IMAGE} on ${REMOTE_HOST} and (re)starting..."
ssh "${REMOTE_HOST}" bash -s <<EOF
set -euo pipefail
cd "${REMOTE_DIR}"
if [ ! -f .env ]; then
  echo "ERROR: ${REMOTE_DIR}/.env is missing on the server." >&2
  echo "  cp .env.example .env  # then fill it in (openssl rand -base64 32 for BETTER_AUTH_SECRET)" >&2
  exit 1
fi
docker build -f src/apps/server/Dockerfile -t "${IMAGE}" src
rm -rf src                # the image holds everything it runs; no stale tree left beside the data
# --remove-orphans: renaming a compose service leaves the old container running and
# unmanaged. That once stranded a second app process bind-mounting the same ./data,
# i.e. two writers on one set of SQLite files. Never again.
docker compose up -d --remove-orphans
docker image prune -f     # drop the now-dangling previous image (dangling only — leaves other apps alone)
EOF

echo "==> Done. ${REV} should be live via your reverse proxy."
