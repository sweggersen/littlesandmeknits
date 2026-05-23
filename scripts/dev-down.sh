#!/usr/bin/env bash
# Tear down the local dev stack started by dev-up.sh.
# Keeps Supabase volumes intact (your local data survives).

set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Stopping Astro dev server…"
pkill -f "astro dev" 2>/dev/null && echo "✓ Stopped" || echo "  (not running)"

echo "→ Stopping Supabase containers…"
supabase stop 2>/dev/null && echo "✓ Stopped" || echo "  (not running)"

echo "→ OrbStack left running (quit from menu bar if you want it off)"
