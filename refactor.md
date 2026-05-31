# Refactor plan — Strikketorget hardening

**Status:** in progress
**Owner:** Sam + Claude
**Started:** 2026-05-31
**Rule:** until this document says every item is ☑, all other work is paused except urgent production fixes.

This is the single source of truth for the refactor. We march top-to-bottom. Each item has a `Goal`, `Why`, `Files`, `Steps`, `Acceptance`, and `Effort`. Tick the box when done.

---

## Phase order

| Tier | When | Items |
|---|---|---|
| **T1 — Ship-stopping** | First. Don't ship features until done. | 1, 4, 11, 16 |
| **T2 — Hard to walk back** | Right after T1. Each touches data. | 2, 7, 12 |
| **T3 — Compounding pain** | Once foundations are stable. | 5, 6, 14 |
| **T4 — Dev velocity** | Quality-of-life. Parallelisable. | 3, 9, 10, 13 |
| **T5 — Cleanup** | Wraps. | 8, 15 |

---

## Tier 1 — Ship-stopping

### ☐ Item 1 — Service-layer discipline

**Goal:** every write goes through `src/lib/services/`. API routes are thin shells.

**Why:** 60% of API routes bypass the service abstraction today (86 of 218 routes use `buildServiceContext`). New devs don't know where the source of truth is. Authorization is reinvented per route.

**Files:**
- Audit list: `find src/pages/api -name '*.ts' -type f | sort` (~218 files)
- Pattern reference: any existing service-using route, e.g. `src/pages/api/marketplace/commissions/accept.ts`

**Steps:**
1. Generate inventory of API routes that don't import a service. Save as `audit/non-service-routes.txt`.
2. Group by domain (`/api/marketplace/commissions/*`, `/api/profile/*`, `/api/projects/*`, …).
3. For each route, the work is:
   - Extract the inline logic to a service function in the appropriate `src/lib/services/<domain>.ts`.
   - Route file becomes: parse input → `buildServiceContext` → call service → `toResponse`.
   - Existing services already have the right shape — copy the convention.
4. After each domain group, run the existing Playwright + Vitest suite for that domain.
5. Add ESLint rule `no-restricted-imports` so non-service modules cannot import `createAdminSupabase`.

**Acceptance:**
- `grep -rL "buildServiceContext\|toResponse" src/pages/api/**/*.ts | wc -l` returns 0 (excluding `dev/`, `health`, webhooks where service pattern doesn't fit).
- `grep -rn "createAdminSupabase" src/pages/api 2>/dev/null` returns matches only in webhooks + dev/.
- All existing tests pass.

**Effort:** 3–5 days.

**Risk:** breaks routes silently if input parsing changes. Mitigation: do one domain at a time, test before moving on.

---

### ☐ Item 4 — Authorization is enforced in services, not pages

**Goal:** one canonical path for "is this user allowed to do X".

**Why:** 53 pages call `getCurrentUser` inline with subtly different redirect/error patterns. Services sometimes check `ctx.user.id === resource.owner_id`, sometimes trust RLS, sometimes use admin client. No grep-able "who can write a refund?".

**Files:**
- `src/lib/auth.ts` — add helpers
- `src/middleware.ts` — extend protected-route matcher
- `src/lib/services/**/*.ts` — adopt new `ensureAuthorized(ctx, resource, op)` helper
- ~53 page modules cleaning up inline `getCurrentUser`

**Steps:**
1. Add to `src/lib/auth.ts`:
   ```ts
   requireUser(opts): user | Response   // returns 302 to login or user
   requireRole(opts, roles): user | Response
   ```
2. Extend middleware so auth-gated path prefixes (`/studio`, `/profile`, `/inbox`, `/innstillinger`, `/admin`) attach `Astro.locals.user` server-side and bounce to login if missing.
3. Add `requireResourceOwner(ctx, table, id)` to `src/lib/services/types.ts` — checks RLS-style ownership without admin-bypass.
4. Sweep page modules: remove inline `getCurrentUser` where middleware now handles it. Keep `Astro.locals.user`.
5. Replace ad-hoc role checks with `requireRole`.

**Acceptance:**
- `grep -rn "getCurrentUser" src/pages 2>/dev/null` is significantly smaller (target: <10, all in shared routes that genuinely need user-or-anon branching).
- Services never call `getCurrentUser`; they always receive a verified user via ctx.
- Every redirect to `/login` includes a `next=` param (CI grep check).

**Effort:** 1–2 days.

---

### ☐ Item 11 — RLS policies have tests

**Goal:** automated proof that anonymous, buyer, seller, knitter, moderator, admin all see what they're supposed to and nothing else.

**Why:** RLS is the last line of defence against cross-user data leaks. Zero tests today.

**Files:**
- New: `e2e/rls.spec.ts` and/or `src/lib/__tests__/rls.test.ts` (Vitest with local Supabase)
- New: `supabase/seed-test-rls.sql` (fixture users for each role)

**Steps:**
1. Define fixture users: `alice` (buyer), `bob` (seller), `charlie` (third party), `mod`, `admin`.
2. For each protected table (profiles, listings, commission_requests, commission_offers, projects, project_logs, conversations, marketplace_messages, stores, store_members, disputes, refunds, …), write assertions:
   - Owner sees own rows.
   - Counterpart (the other side of the trade) sees the rows they should.
   - Third party sees nothing or only public.
   - Moderator sees flagged-only.
   - Admin sees everything.
3. Run on every CI build.
4. When migrations add a new table or column with sensitive data, add the corresponding assertion as part of the migration PR (enforced via a checklist in CLAUDE.md).

**Acceptance:**
- Every table currently using RLS has at least one positive and one negative test.
- Test suite runs in <30s.
- Failing tests block CI merge.

**Effort:** 1 day to set up + ongoing additions per table.

---

### ☐ Item 16 — Eliminate silent failures in commerce paths

**Goal:** any failure in money-touching code either rolls back the parent operation or lands in a dead-letter queue we can audit.

**Why:** found 10 catch-and-swallow blocks. I just added one to `acceptOffer` (project create failure). In a payment system this is how complaints six months later get tied back to "we saw the error but kept going".

**Files:**
- `src/lib/services/commissions.ts` — `acceptOffer`, `payCommission`, `markCompleted`, `confirmDelivery`
- `src/lib/services/listings.ts` — capture/refund paths
- `src/lib/services/refunds.ts`
- `src/lib/services/disputes.ts`
- `src/pages/api/stripe/webhook.ts`

**Steps:**
1. New table: `dead_letter_events` (migration).
   ```sql
   create table dead_letter_events (
     id uuid pk,
     occurred_at timestamptz default now(),
     context jsonb,        -- service + input + user
     error text,
     resolved_at timestamptz,
     resolved_by uuid references auth.users,
     resolution_note text
   );
   ```
2. New helper `recordDeadLetter(ctx, { service, input, error })` in `src/lib/services/dead-letter.ts`.
3. Replace each catch-and-swallow site with one of:
   - Throw and let the parent transaction roll back.
   - Call `recordDeadLetter()` + return a soft-fail to the user.
4. New admin page: `/admin/dead-letters` showing unresolved events.

**Acceptance:**
- `grep -rn "console.error\|console.log" src/lib/services src/pages/api/stripe 2>/dev/null` — every result either throws within the same block or calls `recordDeadLetter`.
- Manual smoke test: force a failure (mock Stripe error), confirm it lands in `/admin/dead-letters`.

**Effort:** 1 day.

---

## Tier 2 — Hard to walk back later

### ☐ Item 2 — Split `profiles` into purpose-specific tables

**Goal:** stop using profiles as a junk drawer. Separate buyer-facing identity from seller payout data and signup flags.

**Why:** 30+ columns and growing. PII mixed with display data. RLS gets harder per column added. GDPR data export tries to ship everything.

**Files:**
- New migration: `supabase/migrations/00XX_split_profiles.sql`
- Backfill script in same migration
- Compatibility view to ease the transition
- All `.from('profiles').select(`…`)` call sites get audited

**Steps:**
1. Design the split:
   ```
   profiles               id, display_name, avatar_path, role, created_at, locale
   seller_profiles        id (fk), legal_name, kontonummer, birthdate, address,
                          postal_code, city, kyc_*, stripe_connect_status, ...
   buyer_preferences      id (fk), marketplace_interests, welcomed_at, 
                          strikketorget_welcomed_at, ...
   auth_identities        id (fk), provider, sub, phone, vipps_email
   ```
2. Migration: CREATE the new tables, copy data, keep old columns in place but stop reading them.
3. New code reads from the new tables.
4. Create a compatibility view `profiles_legacy` with the old shape for any read sites we miss.
5. After two prod weeks, drop the legacy columns in a separate migration.

**Acceptance:**
- New tables exist with row counts matching the source columns.
- No code reads `profiles.seller_*`, `profiles.vipps_*`, `profiles.welcomed_at`, etc. — only the new tables.
- GDPR export endpoint pulls from the new tables.

**Effort:** 3–5 days, spread over 2 calendar weeks for safety.

---

### ☐ Item 7 — Consolidate Stripe Connect state

**Goal:** one truth column for "seller is verified".

**Why:** `stripe_onboarded` (boolean, legacy Standard era) + `stripe_connect_status` (enum, current Custom) coexist. The webhook keeps both in sync but read sites are split. Bug-prone.

**Files:**
- `src/pages/api/stripe/webhook.ts`
- `src/pages/market/listing/[id].astro` (line 141)
- `src/pages/market/store/[slug]/admin/index.astro`
- Anything else with `stripe_onboarded`

**Steps:**
1. Add a migration removing `stripe_onboarded` after one prod week of observation that the enum is correctly maintained.
2. Replace every read of `stripe_onboarded` with `stripe_connect_status === 'verified'`.
3. Update the webhook to stop writing `stripe_onboarded`.
4. Drop the column.

**Acceptance:**
- `grep -rn "stripe_onboarded" src/ 2>/dev/null` returns 0.
- Column dropped.

**Effort:** half a day after grace period.

---

### ☐ Item 12 — Schema baseline consolidation

**Goal:** new contributors don't have to read 70 migrations to understand the schema.

**Why:** linear migration accumulation is fine until ~30. We're at 70. Onboarding pain is real.

**Files:**
- New: `supabase/migrations/_archive/` (move old migrations here)
- New: `supabase/migrations/0001_baseline.sql` (current schema snapshot)

**Steps:**
1. Pick a cutoff. Recommend: everything ≤ 0067 (before the Vipps + Stripe Connect Custom + commission-project work).
2. Run `pg_dump --schema-only` against a prod-mirror DB after applying through 0067.
3. Save the dump as `0001_baseline.sql`. Move 0001–0067 to `_archive/`.
4. Renumber 0068+ to start at 0002.
5. In prod, drop `supabase_migrations.schema_migrations` rows for the archived files (they're already applied, just hiding from Supabase's tracking).
6. Document the procedure in README.

**Acceptance:**
- `supabase db reset` from scratch produces a schema identical to current prod.
- Migration count drops to <10.

**Effort:** 1 day, careful coordination required.

**Risk:** if prod's schema diverges slightly from migrations (drift), the baseline will mask it. Mitigation: diff prod against baseline before promoting.

---

## Tier 3 — Compounding pain

### ☐ Item 5 — test-exec calls real services, not duplicates them

**Goal:** demo harness fixtures execute the same code paths users hit.

**Why:** `test-exec.ts` is 1579 lines of parallel implementations of services. Just witnessed: it didn't set `reserved_at` because someone forgot to mirror a service change. Drifts every release.

**Files:**
- `src/pages/api/dev/test-exec.ts` (the offender)
- All `src/lib/services/*.ts` (callers)

**Steps:**
1. For each test-exec action, identify the corresponding service function (e.g. `purchase-listing` → `listings.purchaseListing` — but with Stripe bypass; `accept-offer` → `commissions.acceptOffer`).
2. Build a "synthetic ctx" helper that takes an actor email and returns a `ServiceContext` as if that user was logged in.
3. test-exec actions become thin wrappers: parse args → `synthCtx(actor)` → `service.method(ctx, input)` → return ctx-friendly response.
4. Special cases (Stripe Checkout bypass, file upload simulation) live in `src/lib/services/__test_helpers__/` and are imported by the real services in test mode.
5. Delete the dead-code case branches.

**Acceptance:**
- `test-exec.ts` < 500 lines.
- Every case body is ≤ 10 lines.
- Removing a service function makes the test-exec case fail to compile.

**Effort:** 2 days.

---

### ☐ Item 6 — Split god components

**Goal:** no Astro page > 600 lines.

**Why:**

| File | Lines |
|---|---|
| `pages/dev/test-tower.astro` | 1722 |
| `pages/api/dev/test-exec.ts` | 1579 |
| `pages/market/listing/[id].astro` | 1379 |
| `pages/dev/ui-flows.astro` | 966 |
| `pages/studio/projects/[id].astro` | 849 |
| `pages/market/commissions/[id].astro` | 761 |

These are merge-conflict generators and reading nightmares. Each holds multiple sub-views interleaved.

**Files:**
- Top priority: `market/listing/[id].astro` and `market/commissions/[id].astro` because both are state machines.

**Steps per file:**
1. Identify the state machine. For `listing/[id]`: `active|reserved|shipped|sold|disputed|rejected` × `isOwner|isBuyer|isAnon`.
2. Extract per-state components into `src/components/listing/<State><Role>.astro`.
3. Main page becomes a switch: load data, pick the right component.
4. Modals (buy, bid, share, report) move to `src/components/listing/modals/`.
5. Inline `<script>` moves to `src/lib/client/listing.ts` and is imported once.

**Acceptance:**
- No file in `src/pages/**` exceeds 600 lines.
- Each extracted component has a `*.test.tsx` or appears in `/dev/screens`.

**Effort:** 2–3 days per file.

---

### ☐ Item 14 — Service test coverage

**Goal:** every service file has a peer `*.test.ts`.

**Why:** 30 service files, 4 with tests. Standing rule in CLAUDE.md is "tests required" — not enforced.

**Files:**
- `src/lib/services/*.ts` (the ones without `.test.ts`)

**Steps:**
1. Order by criticality: checkout, listings (purchase + dispute + refund), commissions, stripe-connect, payouts, refunds, disputes first. Reviews + favorites + yarn last.
2. Each test file covers:
   - Happy path
   - Each branch that returns `fail(...)`
   - Authorization (denied for non-owner)
3. Add CI check: every `src/lib/services/<name>.ts` must have `src/lib/services/<name>.test.ts` OR `__tests__/<name>.test.ts`.

**Acceptance:**
- 30/30 services have peer tests.
- CI rejects new service files without tests.

**Effort:** Ongoing. ~1 hour per service, ~30 hours total.

---

## Tier 4 — Dev velocity

### ☐ Item 3 — Generate Supabase types, remove `as any`

**Goal:** type the database schema, kill `as any` on query results.

**Why:** 139 `as any` casts. Most insidious are the ones on Supabase query results — refactor a join and TS can't help.

**Files:**
- `src/lib/supabase.ts` (typed client)
- `src/lib/database.types.ts` (generated)
- Sweep all `as any` from `src/lib/services/`, `src/pages/`

**Steps:**
1. Add npm script: `"db:types": "supabase gen types typescript --linked > src/lib/database.types.ts"`.
2. Update `createServerSupabase` / `createAdminSupabase` to be `SupabaseClient<Database>`.
3. Run script after every migration; commit the generated file.
4. Remove `as any` from query result casts (will surface real type issues).
5. Window-attribute hacks (e.g. `(trigger as any)._navBound`) move to a typed WeakMap module.

**Acceptance:**
- `grep -rn "as any" src/lib/services 2>/dev/null` returns 0.
- `grep -rn "as any" src/ 2>/dev/null` < 20 (only legitimate cases with explanatory comments).

**Effort:** 1 day setup + 1 day sweep.

---

### ☐ Item 9 — Client controller, not inline `<script>` sprawl

**Goal:** one place for client-side wiring.

**Why:** 20 pages have inline `<script>` blocks. Each duplicates `astro:page-load` registration + bind-once sentinels. New devs invent their own pattern.

**Files:**
- New: `src/lib/client/index.ts` (entry, registered via `<ClientRouter />` or similar)
- Each existing inline script moves to a named module

**Steps:**
1. Create `src/lib/client/controllers/<name>.ts` for each current inline script.
2. Each exports an `init()` function. The entry imports them all and registers on `astro:page-load`.
3. Common patterns (bind-once guard, delegated event listeners, sessionStorage cache) move to `src/lib/client/dom.ts`.
4. Delete the inline `<script>` blocks. Layout imports the entry once.

**Acceptance:**
- `grep -c "<script" src/pages 2>/dev/null` < 5 (only legitimate per-page state injection via `define:vars`).

**Effort:** 1–2 days.

---

### ☐ Item 10 — Single env-import boundary

**Goal:** swap runtime without rewriting 108 files.

**Why:** `import { env } from 'cloudflare:workers'` in 108 places hard-codes the Cloudflare Workers runtime. Cannot deploy elsewhere.

**Files:**
- New: `src/lib/env.ts`
- All callers

**Steps:**
1. `src/lib/env.ts` exports a typed `getEnv()` function. Internally imports `cloudflare:workers`. Caches.
2. ESLint rule: `no-restricted-imports: ['error', 'cloudflare:workers']` outside `src/lib/env.ts`.
3. Sweep all current imports to use `getEnv()`.

**Acceptance:**
- `grep -rn "from 'cloudflare:workers'" src/ 2>/dev/null` returns 1 (env.ts only).

**Effort:** half a day.

---

### ☐ Item 13 — Auth middleware does the gating

**Goal:** auth-required path prefixes redirect at middleware, not in every page.

**Why:** 53 pages with `if (!user) return Astro.redirect('/login?next=...')`. 53 places to forget `next=`. Already had bugs from inconsistent encoding.

**Files:**
- `src/middleware.ts`
- 53 pages losing their auth gate

**Steps:**
1. Middleware checks if path matches `/^(\/studio|\/profile|\/inbox|\/innstillinger|\/admin)/`. If yes, calls `getCurrentUser`; if no user, redirects with `next` + correct encoding.
2. Stash user on `Astro.locals.user`.
3. Sweep page files: remove inline `getCurrentUser` + redirect; read `Astro.locals.user` instead.

**Acceptance:**
- `grep -rn "getCurrentUser" src/pages 2>/dev/null` < 10.
- `grep -rn "redirect.*login.*next" src/pages 2>/dev/null` < 5.

**Effort:** half a day.

---

## Tier 5 — Cleanup

### ☐ Item 8 — `ensureCommissionProject` extraction

**Goal:** one place that creates/links a commission project.

**Why:** `acceptOffer` creates it. `payCommission` also creates it as fallback. Drift waiting to happen.

**Files:**
- `src/lib/services/commissions.ts`

**Steps:**
1. Extract:
   ```ts
   async function ensureCommissionProject(ctx, offer, request, opts): Project
   ```
2. Both `acceptOffer` and `payCommission` call it.
3. Status defaults: opts.startActive controls planning vs active.

**Acceptance:**
- Only one insert into `projects` with `commission_offer_id` set.
- Both services pass the same test fixture and produce identical project rows.

**Effort:** half a day.

---

### ☐ Item 15 — Consolidate NO/EN route aliases

**Goal:** pick one route language; the other is a SEO-only redirect.

**Why:** middleware has a 30-entry remap table. Hand-maintained. We just had a bug where it ate `/prosjekt`.

**Files:**
- `src/middleware.ts`
- Astro page directories

**Decision needed:** primary language for internal routes. **Recommended: Norwegian** (audience match, brand consistency). English aliases stay only for legacy bookmarks.

**Steps:**
1. Pick Norwegian as canonical (or English — decide once).
2. Move pages to canonical-language directories.
3. Build a single `redirects` table generated from the route manifest. Middleware reads the table instead of having a hardcoded segment map.
4. Each entry has a TTL — auto-expire legacy redirects after 1 year of zero hits.

**Acceptance:**
- The route remap table lives in one file with one constant.
- No more "segment X gets rewritten everywhere" surprises.

**Effort:** 1–2 days.

---

## How we'll work

- One PR per item. PR title prefix: `refactor(N): <subject>` where N is the item number.
- Each PR updates this file: tick the box, link the merge commit.
- No new feature work merges until items 1, 4, 11, 16 are ticked.
- If something in the refactor breaks prod, fix forward with a follow-up PR — don't roll back a half-completed item.

## Definition of "done" for the whole refactor

When every checkbox is ticked AND CLAUDE.md has been updated to prevent regression on each item AND CI enforces the rules. Then we close this file out.
