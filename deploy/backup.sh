#!/bin/sh
# Daily copy of the app's tables (Supabase "public" schema) into ./backups on
# the VPS, keeping the newest BACKUP_KEEP (default 14). Runs in the "backup"
# service of docker-compose.yml; restore steps: docs/DEPLOY.md.
# "sh deploy/backup.sh now" (inside the service) makes one copy and exits.
set -u -o pipefail
KEEP=${BACKUP_KEEP:-14}

backup() {
  file="/backups/arachi-$(date -u +%Y-%m-%d).sql.gz"
  if pg_dump --schema=public --no-owner --no-privileges "$DATABASE_URL" | gzip > "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "$(date -u +%FT%TZ) Backup saved: $(basename "$file") ($(du -h "$file" | cut -f1))"
    ls -1t /backups/arachi-*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
  else
    rm -f "$file.tmp"
    echo "$(date -u +%FT%TZ) Backup FAILED: pg_dump could not read the database (see the error above)"
    return 1
  fi
}

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set in .env: nothing to back up."
  exec sleep infinity
fi

if [ "${1:-}" = "now" ]; then
  backup
  exit
fi

# Stop at once on "docker compose stop" (as the container's first process the
# shell would otherwise ignore it and be killed after 10 seconds).
trap 'exit 0' TERM INT

# One copy per day (UTC); checked hourly so a restart or a failed try is retried.
while true; do
  [ -s "/backups/arachi-$(date -u +%Y-%m-%d).sql.gz" ] || backup
  sleep 3600 &
  wait $!
done
