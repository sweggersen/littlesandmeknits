# Local dev environment

Project runs on a split DB: **local Supabase for dev**, **cloud Supabase for prod**. Local is a full Supabase instance in OrbStack/Docker, started by the helper scripts. Cloud is the existing `cftibmirzakolkcqvqsq` project, kept clean for production.

## One-command start

```
scripts/dev-up.sh
```

What it does:
1. Boots OrbStack (if not running) and waits for the Docker socket.
2. Starts Supabase containers via `supabase start` (no-op if already up).
3. **Applies any pending local migrations** via `supabase migration up --local`. So whenever you add a new file under `supabase/migrations/`, the next `dev-up.sh` brings local in sync.
4. Reads the current LAN IP (`ipconfig getifaddr en0/en1`).
5. Writes `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` into both `.dev.vars` and `.env.local`. Workerd can't resolve `127.0.0.1` to the host's loopback, so we always use the LAN IP.
6. Kills any existing `astro dev` and launches a fresh one with logs at `/tmp/littlesandme-dev.log`.

## Teardown

```
scripts/dev-down.sh
```

Stops Astro and Supabase. OrbStack stays running (quit from its menu bar if you want it off — Supabase volumes persist regardless).

## Endpoints

| Service | URL |
|---|---|
| App (dev) | http://localhost:4321 |
| Supabase API | http://<LAN-IP>:54321 |
| Supabase Studio | http://127.0.0.1:54323 |
| Inbucket (test email) | http://127.0.0.1:54324 |
| Postgres (direct) | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

## Migrations workflow

**Always migrate local first, then push to cloud.**

```
# 1. write the migration
supabase migration new <descriptive_name>
# edit supabase/migrations/<timestamp>_<name>.sql

# 2. apply locally (or just re-run dev-up.sh — it auto-applies)
supabase migration up --local

# 3. test the app against local

# 4. push to cloud when satisfied
supabase db push
```

If a local migration goes wrong, you can blow away local state and re-apply everything from scratch:

```
supabase db reset    # drops + recreates local DB, replays every migration
```

## Snapshot prod → local (for bug investigations)

Local doesn't track prod automatically — it's its own playground. When you need real data locally to investigate a bug or quirk:

```
scripts/snapshot-prod.sh             # data + storage binaries
scripts/snapshot-prod.sh --no-files  # data only (much faster)
```

The script wipes local data, dumps cloud (`auth + public + storage` schemas), restores into local, then mirrors all storage binaries. Schema stays — only data is replaced. Asks for confirmation before wiping.

## Cloud cleanup

If you wiped the cloud DB's data (TRUNCATE on `public.*` etc.), storage row metadata is gone but the actual S3 blobs may linger as orphans. To delete the orphan binaries:

```
scripts/cloud-storage-clean.sh --dry-run   # see what would be deleted
scripts/cloud-storage-clean.sh             # actually delete
```

The script reads cloud creds from `.dev.vars.cloud`, walks every bucket recursively, and DELETEs each file via the Storage REST API. Buckets themselves are preserved.

## Reset to cloud temporarily

```
cp .dev.vars.cloud  .dev.vars
cp .env.local.cloud .env.local
pkill -f "astro dev"; npm run dev
```

Next `scripts/dev-up.sh` puts it back on local.

## Things that aren't local

- **Resend (transactional email)** — sends for real even from dev. Local Inbucket only catches Supabase Auth emails (signup confirmations, magic links).
- **Stripe** — uses Stripe test mode from `.dev.vars`. Webhooks must be tunneled: `stripe listen --forward-to localhost:4321/api/stripe/webhook`.
- **Cloudflare KV (`SESSION`)** — Miniflare provides a local in-memory KV; resets when the dev server restarts.

## Backups (don't commit)

- `.dev.vars.cloud` — pre-split cloud service-role key
- `.env.local.cloud` — pre-split cloud anon key + URL

The real prod creds live in the Cloudflare Worker's secret store.
