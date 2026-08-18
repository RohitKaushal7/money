#!/usr/bin/env bash
#
# Manual deploy: build the image locally, ship it to the server over SSH (no registry, no CI), and restart.
# Self-cleaning — the image tar is deleted on both ends and dangling images are pruned, so nothing piles up.
#
#   REMOTE_HOST=myserver ./deploy.sh
#
# Most people should not need this: `docker compose pull` off the published image (see README) is the
# supported path. This exists for pushing a locally built image to your own box without a registry.
#
# Prerequisites on the server, one-time:
#   - Docker + docker compose, and a reverse proxy forwarding your HTTPS host to :3000
#   - <REMOTE_DIR>/.env created from .env.example (deploy.sh rsyncs the template and refuses to start without it)
set -euo pipefail
cd "$(dirname "$0")"

# Override both from the environment; an SSH host alias (see ~/.ssh/config) is the tidiest REMOTE_HOST.
REMOTE_HOST="${REMOTE_HOST:?set REMOTE_HOST to your server, e.g. REMOTE_HOST=myserver ./deploy.sh}"
REMOTE_DIR="${REMOTE_DIR:-apps/money}"   # relative to the remote home (root -> /root/apps/money)
IMAGE="money:latest"
TAR="money-image.tar.gz"
TMP_TAR="/tmp/${TAR}"

echo "==> Building ${IMAGE}..."
docker build -f apps/server/Dockerfile -t "${IMAGE}" .

echo "==> Saving image to ${TMP_TAR}..."
docker save "${IMAGE}" | gzip > "${TMP_TAR}"

echo "==> Syncing image + compose + env template to ${REMOTE_HOST}:${REMOTE_DIR}/ ..."
ssh "${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR}"
rsync -avz "${TMP_TAR}" docker-compose.yml .env.example "${REMOTE_HOST}:${REMOTE_DIR}/"

echo "==> Loading image and (re)starting on ${REMOTE_HOST}..."
ssh "${REMOTE_HOST}" bash -s <<EOF
set -euo pipefail
cd "${REMOTE_DIR}"
if [ ! -f .env ]; then
  echo "ERROR: ${REMOTE_DIR}/.env is missing on the server." >&2
  echo "  cp .env.example .env  # then fill it in (openssl rand -base64 32 for BETTER_AUTH_SECRET)" >&2
  exit 1
fi
gunzip -c "${TAR}" | docker load
# --remove-orphans: renaming a compose service leaves the old container running and
# unmanaged. That once stranded a second app process bind-mounting the same ./data,
# i.e. two writers on one set of SQLite files. Never again.
docker compose up -d --remove-orphans
docker image prune -f     # drop the now-dangling previous image (dangling only — leaves other apps alone)
rm -f "${TAR}"
EOF

echo "==> Cleaning up locally..."
rm -f "${TMP_TAR}"
docker image prune -f

echo "==> Done. The app should be live via your reverse proxy."
