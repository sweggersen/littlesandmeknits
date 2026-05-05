#!/usr/bin/env bash
# One-shot Supabase project setup via the Management API.
#
#   - applies the schema migration
#   - configures auth URLs (Site URL + redirect URLs)
#   - creates the private `patterns` storage bucket
#
# Required env:
#   SUPABASE_PAT     Personal Access Token (https://supabase.com/dashboard/account/tokens)
#   PROJECT_REF      Project ref from your Supabase URL (e.g. cftibmirzakolkcqvqsq)
#
# Optional env:
#   SITE_URL         Defaults to https://www.littlesandmeknits.com
#
# Usage:
#   SUPABASE_PAT=sbp_... PROJECT_REF=cftibmirzakolkcqvqsq bash scripts/setup-supabase.sh
#
# Revoke the PAT in Supabase after this completes — it's only needed once.

set -euo pipefail

: "${SUPABASE_PAT:?SUPABASE_PAT not set}"
: "${PROJECT_REF:?PROJECT_REF not set}"
SITE_URL="${SITE_URL:-https://www.littlesandmeknits.com}"

API="https://api.supabase.com/v1/projects/${PROJECT_REF}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_FILE="${SCRIPT_DIR}/../supabase/migrations/0001_initial_schema.sql"

if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "Schema file not found at $SCHEMA_FILE" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (brew install jq)" >&2
  exit 1
fi

call() {
  local method=$1 path=$2 body=${3:-}
  local args=(-fsS -X "$method" "${API}${path}"
    -H "Authorization: Bearer ${SUPABASE_PAT}"
    -H "Content-Type: application/json")
  if [[ -n "$body" ]]; then
    args+=(--data "$body")
  fi
  curl "${args[@]}"
}

echo "▸ Applying SQL migration..."
SQL_BODY=$(jq -Rsa . < "$SCHEMA_FILE" | jq -n --rawfile sql "$SCHEMA_FILE" '{query: $sql}')
call POST /database/query "$SQL_BODY" >/dev/null
echo "  ✓ Schema applied"

echo "▸ Configuring auth URLs..."
AUTH_BODY=$(jq -n --arg site "$SITE_URL" '{
  site_url: $site,
  uri_allow_list: ($site + "/api/auth/callback,http://localhost:4321/api/auth/callback")
}')
call PATCH /config/auth "$AUTH_BODY" >/dev/null
echo "  ✓ Auth URLs configured"

echo "▸ Creating patterns storage bucket..."
BUCKET_BODY='{"id":"patterns","name":"patterns","public":false}'
HTTP_CODE=$(curl -sS -o /tmp/lsmk-bucket.json -w "%{http_code}" \
  -X POST "${API}/storage/buckets" \
  -H "Authorization: Bearer ${SUPABASE_PAT}" \
  -H "Content-Type: application/json" \
  --data "$BUCKET_BODY")
case "$HTTP_CODE" in
  200|201) echo "  ✓ Bucket created" ;;
  409)     echo "  ✓ Bucket already exists" ;;
  *)
    echo "  ✗ Bucket creation failed (HTTP ${HTTP_CODE}):" >&2
    cat /tmp/lsmk-bucket.json >&2
    exit 1
    ;;
esac

echo
echo "✅ Supabase setup complete"
echo
echo "Next:"
echo "  • Revoke the PAT at https://supabase.com/dashboard/account/tokens"
echo "  • Confirm Cloudflare env vars are set (PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SITE_URL)"
echo "  • Confirm Worker secret SUPABASE_SERVICE_ROLE_KEY is set"
