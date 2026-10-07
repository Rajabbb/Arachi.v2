#!/bin/sh
# Pulls the latest main and rebuilds the app; migrations run when it starts.
# Run on the VPS from the repo folder: sh deploy/update.sh
set -e
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose up -d --build
docker image prune -f
docker compose ps
