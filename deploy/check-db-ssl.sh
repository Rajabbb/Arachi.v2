#!/bin/sh
# Checks the Supabase certificate in certs/supabase-ca.crt before the app uses it.
# Runs in a one-off container; the running site is not touched.
# Run on the VPS from the repo folder: sh deploy/check-db-ssl.sh
set -e
cd "$(dirname "$0")/.."
if [ ! -f certs/supabase-ca.crt ]; then
  echo "XƏTA: certs/supabase-ca.crt tapılmadı." >&2
  exit 1
fi
docker compose run --rm --no-deps -e DATABASE_SSL_CA=/app/certs/supabase-ca.crt app npx tsx server/db/checkSsl.ts
