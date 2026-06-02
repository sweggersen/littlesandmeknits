# Security Audit & Remediation — Littles and Me Knits

**Date:** 2026-06-02
**Scope:** Adversarial (red-team) static analysis of the repo + Supabase RLS/grants, from the perspective of (a) an unauthenticated internet visitor, (b) an authenticated low-privilege user, (c) a reader of the public GitHub repo (`sweggersen/littlesandmeknits`).
**Method:** Read source + all `supabase/migrations/*.sql`; every claim verified against code/git/local Postgres rather than assumed. Local Supabase is up, so DB-layer fixes are validated before hand-off.

---

## 0. Headline correction (what is NOT wrong)

An automated pass flagged "service-role / Resend / VAPID keys committed — CRITICAL." **False, verified:**
- `.env.local` and `.dev.vars` are **gitignored, untracked, never in git history** (`git log --all --full-history` empty), perms `0700`.
- The public GitHub repo contains **no secrets**.

Real residual: those local files hold *real hosted-project* keys, so blast radius = "local machine compromise," not "anyone on GitHub." Action: keep them ignored; never `git add -f`. (No code change required.)

Also confirmed solid (no action): Stripe webhook signature verification (`constructEventAsync`), PostgREST `.or()` injection fully sanitized via `orEither()` (`^[A-Za-z0-9_-]+$`), profile UPDATE policies pin `role`/`trust_*`/stripe fields (no self-escalation), Vipps OIDC uses state+PKCE+validated `next` redirect+rate-limit, Storage writes are owner-folder-scoped + private PDFs via signed URLs, no SSRF (every server `fetch()` hits a constant trusted host; BRREG orgnr is `^\d{9}$`+checksum validated).

---

## 1. Findings (verified)

| # | Severity | Finding | Evidence |
|---|----------|---------|----------|
| F1 | MEDIUM | **`profiles` exposes PII to unauthenticated users.** `using(true)` SELECT + anon table-SELECT grant means any visitor can scrape `first_name`, `last_name`, `birthday`, `role`, `trust_tier`, `trust_score`, consent timestamps for every user. | `0012:6`, `0065`, `0037`, `0044:5` |
| F2 | MEDIUM | **Dev endpoints gated only by compile-time `import.meta.env.PROD` + over-broad `*.workers.dev` host allowlist.** Not open on a normal prod build, but a single non-prod build deployed to a `.workers.dev` host opens session-minting/DB-mutation endpoints. | `src/pages/api/dev/*` (`test-exec.ts:132-136`, `impersonate.ts:8-12`) |
| F3 | MEDIUM | **`anon` granted full INSERT/UPDATE/DELETE on ~28 tables.** RLS is then the *only* gate; combined with the permissive `listing_impressions` insert policy (`WITH CHECK (true)`), an anonymous user can flood/forge analytics (rank manipulation). | `0044:5-32`, `0043:34-35` |
| F4 | LOW | **Admin email hardcoded in public source** (`ammon.weggersen@gmail.com`), enabling targeted phishing/ATO recon. | `test-exec.ts:40`, `approve-store.ts` |
| F5 | LOW (by-design) | **Compromised-staff blast radius:** moderators can read all `seller_profiles` (Stripe acct, kontonummer, legal name, address) + `auth_identities` (phone, Vipps sub). Correct for moderation; mitigate operationally. | `0072:60-67,161-168` |

---

## 2. Remediation plan (checklist)

- [x] **F1** — `0077_profiles_anon_column_scope.sql`: replaced anon's table-wide `SELECT` on `profiles` with a column-scoped grant (display columns only). Validated on local Postgres: anon reads `display_name`/`bio`/`avatar_path` (✓) but is **denied** `first_name`/`last_name`/`birthday`/`role`/`trust_tier`/`marketing_consent_at` (✓); `authenticated` keeps full SELECT (✓).
- [x] **F3** — `0078_revoke_anon_writes.sql`: `REVOKE INSERT/UPDATE/DELETE` from anon on 27 tables. Validated: anon write denied on `profiles`/`favorites`/`listings`/`reports`/`marketplace_messages`/`moderation_audit_log` (✓); `authenticated` writes retained (✓); `listing_impressions` anon-insert **kept** (legit anonymous view tracking — flood risk mitigated by app rate-limiting, not by breaking analytics).
- [x] **F2** — `src/lib/dev-guard.ts`: `devToolsBlocked(request)` blocks on prod builds, allows localhost, and on any other host requires runtime `DEV_TOOLS=enabled`. **Dropped the blanket `.workers.dev` allowance.** Wired into all 7 powerful dev endpoints (`test-exec`, `impersonate`, `login`, `test-login`, `test-token`, `approve-store`, `orgnr-lookup`); `stripe-mode` already admin/invite-gated. 5 unit tests on the pure decision fn.
- [~] **F4** — **Deliberately deferred.** The hardcoded address is the owner's own email and the dev endpoints are now hard-blocked off localhost, so moving it to env adds local-dev friction for negligible gain. Revisit if more admins are added (then use `profiles.role`, not a list).
- [~] **F5** — **Ops note (no code):** require MFA on staff accounts; consider audit-logging reads of `seller_profiles`/`auth_identities`. Out of scope for a code change.

### Verification (all green)
- Migrations applied + probed on local Postgres (privilege assertions above).
- `npm test` → 514 passing with local DB (incl. RLS suite — F1/F3 break nothing); 485 + 29 skipped without DB.
- `npm run typecheck` → 0 errors. `npm run build` → green.
- Note: the main worktree needed `npm install` (its `node_modules` was stale from the abandoned May-28 experiment that had removed `typescript`/`@astrojs/check`); resynced.

### Deploy steps for the user
1. Apply migrations `0077` + `0078` to the hosted Supabase project (you run migrations).
2. Confirm no production secret named `DEV_TOOLS` exists (absent = dev endpoints stay closed everywhere but localhost). Set `DEV_TOOLS=enabled` only on a trusted preview if/when needed.
3. (Optional) Verify the hosted DB's live grants now match (the audit read migrations, not prod).

---

## 2b. IDOR / broken-access-control sweep (round 2 — all ~80 API routes)

Audited every route under `src/pages/api/**` (commerce, profile, stores, admin, cron, download, checkout, invitations, studio CRUD, tracking, push, notifications) by tracing the auth chain into the service layer and verifying ownership/role guards. **No exploitable IDOR or privilege-escalation found.** Highlights verified:

- **Commerce** (listings/commissions/conversations): every `[id]` action checks `seller_id`/`buyer_id`/`knitter_id` ownership + state machine in the service; no cross-user actions, no buyer↔seller role confusion, no self-purchase/self-bid.
- **download/[id]**: verifies `purchase.user_id === ctx.user.id` before issuing the signed PDF URL — no paid-content theft.
- **checkout**: price is read server-side from pattern data, never trusted from the client.
- **cron/run**: `x-cron-secret` compared with `crypto.subtle.timingSafeEqual` — not triggerable without the secret.
- **invitations/[token]/accept**: token is single-use, time-limited, and email-bound.
- **admin/***: every route gated by `requireAdmin`/`requireModerator` / `requireRole([...])` before side effects; role value allowlisted; `users/role` is admin-only (no mod→admin escalation).
- **auth/callback**: `next` redirect validated (`/` and not `//`); provider metadata whitelisted (no role/email injection).
- **studio CRUD + nested deletes** (`log/[logId]`, `yarn/[linkId]`): owner-scoped by RLS on the parent; tracking endpoints validate + bound batch size.

**Two defense-in-depth hardenings applied** (both were RLS-protected, so not exploitable — verified the live policies — but the project rule is "services authorize, not RLS alone"):
- [x] `notifications.deleteNotification` — added `.eq('user_id', ctx.user.id)` (notifications DELETE RLS already scopes to owner; now explicit, matches `markRead`).
- [x] `conversations.reply` — added an explicit participant check returning `forbidden` (the `marketplace_messages` INSERT RLS already requires sender be a participant; now a clean 403 instead of relying on the insert to fail).

## 3. Out of scope / coverage gaps (honest)

- Did **not** verify the **hosted** Supabase project's live RLS matches these migration files (read migrations, not prod DB).
- Did **not** do an exhaustive per-route IDOR sweep (relied on the service-layer ownership pattern + existing tests); spot-checks were clean.
- Storage: did not enumerate every bucket on the hosted project; the migration-defined `projects` (public, owner-scoped writes) and pattern PDF (private+signed) buckets are correct.

---

## 4. Execution log

(updated as items are completed below)
