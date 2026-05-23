#!/usr/bin/env bash
# Bring up the full local dev stack: OrbStack → Supabase → dev server.
# Updates .dev.vars + .env.local with the current LAN IP so the Astro/Worker
# fetch layer can reach the local Supabase (Workerd can't resolve 127.0.0.1).
#
# Usage: scripts/dev-up.sh
# Stop:  scripts/dev-down.sh

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

echo "→ Project: $ROOT"

# ─── 1. OrbStack ────────────────────────────────────────────────────────────
if ! pgrep -xq OrbStack; then
  echo "→ Starting OrbStack…"
  open -a OrbStack
  # Wait for Docker socket to come online (max 30s)
  for i in {1..30}; do
    if docker info >/dev/null 2>&1; then break; fi
    sleep 1
  done
  docker info >/dev/null 2>&1 || { echo "✗ OrbStack didn't expose a Docker socket in 30s"; exit 1; }
fi
echo "✓ OrbStack running"

# ─── 2. Supabase ────────────────────────────────────────────────────────────
if ! docker ps --format '{{.Names}}' | grep -q "^supabase_db_"; then
  echo "→ Starting Supabase (this can take a minute on first run)…"
  supabase start
else
  echo "✓ Supabase already running"
fi

# ─── 2b. Apply any new local migrations ────────────────────────────────────
# Compares files in supabase/migrations against supabase_migrations.schema_migrations.
# Idempotent — `supabase migration up` is safe to run on every startup.
echo "→ Applying any pending migrations to local…"
if supabase migration up --local 2>&1 | tee /tmp/sb-migrate.log | grep -qE "Applied|up to date"; then
  echo "✓ Migrations current"
else
  echo "⚠ Migration step had output — review:"
  tail -10 /tmp/sb-migrate.log
fi

API_URL=$(supabase status -o env 2>/dev/null | awk -F= '/^API_URL=/{gsub(/"/,"",$2); print $2}')
ANON_KEY=$(supabase status -o env 2>/dev/null | awk -F= '/^ANON_KEY=/{gsub(/"/,"",$2); print $2}')
SERVICE_KEY=$(supabase status -o env 2>/dev/null | awk -F= '/^SERVICE_ROLE_KEY=/{gsub(/"/,"",$2); print $2}')

# ─── 3. LAN IP detection ────────────────────────────────────────────────────
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || true)
[ -z "$LAN_IP" ] && LAN_IP=$(ipconfig getifaddr en1 2>/dev/null || true)
[ -z "$LAN_IP" ] && { echo "✗ Could not detect LAN IP (en0/en1). Are you on wifi?"; exit 1; }
SUPABASE_URL="http://${LAN_IP}:54321"
echo "✓ LAN IP $LAN_IP → Supabase URL $SUPABASE_URL"

# ─── 4. Update .dev.vars + .env.local ──────────────────────────────────────
update_kv() {
  local FILE=$1 KEY=$2 VALUE=$3
  [ -f "$FILE" ] || { echo "✗ Missing $FILE"; return 1; }
  if grep -q "^${KEY}=" "$FILE"; then
    # macOS sed in-place
    sed -i '' "s|^${KEY}=.*|${KEY}=\"${VALUE}\"|" "$FILE"
  else
    echo "${KEY}=\"${VALUE}\"" >> "$FILE"
  fi
}

update_kv ".dev.vars"  "PUBLIC_SUPABASE_URL"        "$SUPABASE_URL"
update_kv ".dev.vars"  "SUPABASE_SERVICE_ROLE_KEY"  "$SERVICE_KEY"
update_kv ".env.local" "PUBLIC_SUPABASE_URL"        "$SUPABASE_URL"
update_kv ".env.local" "PUBLIC_SUPABASE_ANON_KEY"   "$ANON_KEY"
echo "✓ Updated .dev.vars + .env.local with local Supabase creds"

# ─── 5. Astro dev server ────────────────────────────────────────────────────
if pgrep -f "astro dev" >/dev/null; then
  echo "→ Restarting Astro dev server…"
  pkill -f "astro dev" || true
  sleep 2
fi

echo "→ Starting Astro dev server (logs: /tmp/littlesandme-dev.log)…"
npm run dev > /tmp/littlesandme-dev.log 2>&1 &
DEV_PID=$!
sleep 4

if ! kill -0 "$DEV_PID" 2>/dev/null; then
  echo "✗ Dev server failed to start. Tail of log:"
  tail -20 /tmp/littlesandme-dev.log
  exit 1
fi

cat <<EOF

────────────────────────────────────────────────
✓ Dev stack up

  App      http://localhost:4321
  Supabase $SUPABASE_URL  (studio: http://127.0.0.1:54323)
  Logs     tail -f /tmp/littlesandme-dev.log
  Stop     scripts/dev-down.sh
────────────────────────────────────────────────
EOF
