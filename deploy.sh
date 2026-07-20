#!/usr/bin/env bash
#
# Manual deploy: build the image locally, ship it to the server over SSH (no registry, no CI), and restart.
# Self-cleaning — the image tar is deleted on both ends and dangling images are pruned, so nothing piles up.
#
#   ./deploy.sh
#
# Prerequisites on the server (cbs), one-time:
#   - Docker + docker compose, and a reverse proxy (Nginx Proxy Manager) forwarding your HTTPS host to :3000
#   - ~/apps/money/.env created from .env.example (deploy.sh rsyncs the template and refuses to start without it)
set -euo pipefail
cd "$(dirname "$0")"

REMOTE_HOST="cbs"
REMOTE_DIR="apps/money"            # relative to the remote home (root@cbs -> /root/apps/money)
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
docker compose up -d
docker image prune -f     # drop the now-dangling previous image (dangling only — leaves other apps alone)
rm -f "${TAR}"
EOF

echo "==> Cleaning up locally..."
rm -f "${TMP_TAR}"
docker image prune -f

echo "==> Done. The app should be live via your reverse proxy."
