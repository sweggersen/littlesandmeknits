#!/usr/bin/env bash
# Delete every binary in the cloud Supabase Storage buckets.
# Useful after wiping the cloud DB — DELETE FROM storage.objects clears the
# row metadata but the S3 blobs survive as orphans. This script lists every
# bucket, recursively walks every prefix, and deletes each file via the
# Storage REST API. Buckets themselves are kept.
#
# Reads credentials from .dev.vars.cloud (the backup made when we split DBs).
#
# Usage: scripts/cloud-storage-clean.sh
#        scripts/cloud-storage-clean.sh --dry-run

set -euo pipefail
cd "$(dirname "$0")/.."

CREDS_FILE=".dev.vars.cloud"
[ -f "$CREDS_FILE" ] || { echo "✗ $CREDS_FILE missing — can't reach cloud."; exit 1; }

CLOUD_URL=$(awk -F= '/^PUBLIC_SUPABASE_URL=/{gsub(/"/,"",$2); print $2}' "$CREDS_FILE")
CLOUD_KEY=$(awk -F= '/^SUPABASE_SERVICE_ROLE_KEY=/{gsub(/"/,"",$2); print $2}' "$CREDS_FILE")
[ -z "$CLOUD_URL" ] || [ -z "$CLOUD_KEY" ] && { echo "✗ Couldn't parse creds from $CREDS_FILE"; exit 1; }

DRY=""
[ "${1:-}" = "--dry-run" ] && DRY=1 && echo "** DRY RUN — no deletes will happen **"

echo "→ Cloud: $CLOUD_URL"

# List all buckets.
BUCKETS=$(curl -fsSL -H "Authorization: Bearer $CLOUD_KEY" "$CLOUD_URL/storage/v1/bucket" \
  | python3 -c "import sys,json; [print(b['id']) for b in json.load(sys.stdin)]")

[ -z "$BUCKETS" ] && { echo "✓ No buckets to clean."; exit 0; }
echo "→ Buckets: $(echo "$BUCKETS" | tr '\n' ' ')"

TOTAL_OK=0; TOTAL_FAIL=0

# Walk a bucket recursively, deleting every file as we encounter it.
walk_and_delete() {
  local BUCKET=$1 PREFIX="${2:-}"
  local LIST
  LIST=$(curl -fsSL -X POST \
    -H "Authorization: Bearer $CLOUD_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"prefix\":\"$PREFIX\",\"limit\":1000}" \
    "$CLOUD_URL/storage/v1/object/list/$BUCKET" 2>/dev/null || echo "[]")

  echo "$LIST" | python3 -c "
import sys, json
for item in json.load(sys.stdin):
  name = item.get('name','')
  is_folder = item.get('id') is None
  print(('DIR|' if is_folder else 'FILE|') + name)
" | while IFS='|' read -r KIND NAME; do
    local FULL
    if [ -z "$PREFIX" ]; then FULL="$NAME"; else FULL="$PREFIX/$NAME"; fi
    if [ "$KIND" = "DIR" ]; then
      walk_and_delete "$BUCKET" "$FULL"
    else
      if [ -n "$DRY" ]; then
        echo "would delete: $BUCKET/$FULL"
      else
        local HTTP
        HTTP=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE \
          -H "Authorization: Bearer $CLOUD_KEY" \
          "$CLOUD_URL/storage/v1/object/$BUCKET/$FULL")
        if [ "$HTTP" = "200" ]; then
          echo "✓ $BUCKET/$FULL"
          TOTAL_OK=$((TOTAL_OK+1))
        else
          echo "✗ [$HTTP] $BUCKET/$FULL"
          TOTAL_FAIL=$((TOTAL_FAIL+1))
        fi
      fi
    fi
  done
}

for B in $BUCKETS; do
  echo
  echo "── Bucket: $B ──"
  walk_and_delete "$B" ""
done

echo
echo "Done."
