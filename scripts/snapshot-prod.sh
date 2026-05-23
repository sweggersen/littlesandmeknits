#!/usr/bin/env bash
# Snapshot the cloud (production) DB + storage into the local Supabase
# instance for debugging. Wipes local data first — local schema is kept,
# only `auth.users`, `public.*`, `storage.objects` rows are replaced with
# what's in cloud, then storage binaries are mirrored.
#
# Requires: scripts/dev-up.sh has run successfully and .dev.vars.cloud exists.
#
# Usage:
#   scripts/snapshot-prod.sh             # data + binaries
#   scripts/snapshot-prod.sh --no-files  # data only (much faster)

set -euo pipefail
cd "$(dirname "$0")/.."

NO_FILES=""
[ "${1:-}" = "--no-files" ] && NO_FILES=1

CREDS_FILE=".dev.vars.cloud"
[ -f "$CREDS_FILE" ] || { echo "✗ $CREDS_FILE missing — can't reach cloud."; exit 1; }
CLOUD_URL=$(awk -F= '/^PUBLIC_SUPABASE_URL=/{gsub(/"/,"",$2); print $2}' "$CREDS_FILE")
CLOUD_KEY=$(awk -F= '/^SUPABASE_SERVICE_ROLE_KEY=/{gsub(/"/,"",$2); print $2}' "$CREDS_FILE")

# Local creds (current dev session)
LOCAL_URL=$(awk -F= '/^PUBLIC_SUPABASE_URL=/{gsub(/"/,"",$2); print $2}' .dev.vars)
LOCAL_KEY=$(awk -F= '/^SUPABASE_SERVICE_ROLE_KEY=/{gsub(/"/,"",$2); print $2}' .dev.vars)

DB_CONTAINER=$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)
[ -z "$DB_CONTAINER" ] && { echo "✗ Local Supabase isn't running. Run scripts/dev-up.sh first."; exit 1; }

echo "→ Cloud: $CLOUD_URL"
echo "→ Local: $LOCAL_URL (db container: $DB_CONTAINER)"
echo
read -p "This will WIPE local data and replace it with cloud. Continue? (y/N) " ans
[ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "Aborted."; exit 0; }

# ─── 1. Wipe local data (keep schema) ──────────────────────────────────────
echo "→ Wiping local data…"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres <<'SQL' >/dev/null
BEGIN;
SET session_replication_role = replica;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP EXECUTE format('TRUNCATE TABLE public.%I CASCADE', r.tablename); END LOOP;
END $$;
DELETE FROM storage.objects;
DELETE FROM auth.users;
SET session_replication_role = DEFAULT;
COMMIT;
SQL
echo "✓ Local cleared"

# ─── 2. Dump cloud → restore into local ────────────────────────────────────
DUMP_FILE=$(mktemp /tmp/prod-snapshot.XXXXXX.sql)
echo "→ Dumping cloud (auth + public + storage)…"
supabase db dump --data-only --schema auth,public,storage -f "$DUMP_FILE" 2>&1 | tail -5
echo "  $(wc -l < "$DUMP_FILE") lines / $(du -h "$DUMP_FILE" | cut -f1)"

echo "→ Restoring into local…"
cat "$DUMP_FILE" | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres > /tmp/restore.log 2>&1 \
  || { echo "✗ Restore failed. Tail:"; tail -15 /tmp/restore.log; exit 1; }
echo "✓ Data restored"

# ─── 3. Storage binaries ───────────────────────────────────────────────────
if [ -n "$NO_FILES" ]; then
  echo "→ Skipping storage binaries (--no-files)"
else
  echo "→ Mirroring storage binaries…"

  # Ensure all cloud buckets exist locally.
  curl -fsSL -H "Authorization: Bearer $CLOUD_KEY" "$CLOUD_URL/storage/v1/bucket" \
    | python3 -c "
import sys, json
for b in json.load(sys.stdin):
  print(b['id'] + '|' + ('t' if b['public'] else 'f'))
" | while IFS='|' read -r ID PUB; do
      curl -sS -o /dev/null -X POST \
        -H "Authorization: Bearer $LOCAL_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"id\":\"$ID\",\"name\":\"$ID\",\"public\":$( [ "$PUB" = "t" ] && echo true || echo false)}" \
        "$LOCAL_URL/storage/v1/bucket" || true
    done

  # Copy each file referenced by the freshly-restored storage.objects rows.
  OK=0; FAIL=0
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tA -c \
    "SELECT bucket_id || '|' || name FROM storage.objects ORDER BY bucket_id, name;" \
  | while IFS='|' read -r BUCKET KEY; do
    [ -z "$BUCKET" ] && continue
    TMP=$(mktemp)
    HTTP=$(curl -sS -o "$TMP" -w "%{http_code}" \
      -H "Authorization: Bearer $CLOUD_KEY" \
      "$CLOUD_URL/storage/v1/object/$BUCKET/$KEY")
    if [ "$HTTP" != "200" ]; then echo "  DL fail [$HTTP] $BUCKET/$KEY"; rm "$TMP"; continue; fi
    CT=$(file -b --mime-type "$TMP")
    UP=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
      -H "Authorization: Bearer $LOCAL_KEY" \
      -H "Content-Type: $CT" -H "x-upsert: true" \
      --data-binary "@$TMP" \
      "$LOCAL_URL/storage/v1/object/$BUCKET/$KEY")
    if [ "$UP" = "200" ] || [ "$UP" = "201" ]; then echo "  ✓ $BUCKET/$KEY"
    else echo "  ✗ [$UP] $BUCKET/$KEY"; fi
    rm "$TMP"
  done
fi

rm -f "$DUMP_FILE"

cat <<EOF

────────────────────────────────────────────────
✓ Snapshot complete. Local now mirrors cloud.
  App:    http://localhost:4321
  Studio: http://127.0.0.1:54323
────────────────────────────────────────────────
EOF
