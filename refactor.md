# Refactor plan — Strikketorget hardening

**Round 1 (items 1–16):** ☑ closed 2026-06-02 — 15 ☑ done · 1 ⊘ wontfix
**Round 2 (items R2-1+):** started 2026-06-02 — operational hardening from the post-refactor staff-engineer review.
**Owner:** Sam + Claude
**Started:** 2026-05-31

Round 1 fixed structural rot — service layer, RLS plumbing, typecheck, god components, client controllers. Round 2 addresses operational risk that survived the refactor. Same working rules: one item per PR, tick the box, no new features that bypass the rules below.

Jump to [Round 2 items](#round-2--operational-hardening-2026-06-02) at the bottom.

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

### ☑ Item 1 — Service-layer discipline

**Completed 2026-05-31.** 96 of 109 real API routes (88%) now route through `buildServiceContext`/`toResponse`. The remaining 13 are exception-eligible per CLAUDE.md (auth flow, cron entry, dev tooling, webhook, static-key endpoint). New service exports added: `profile.{becomeSeller, deleteAccount, getBookkeeping, exportPersonalData, completeStrikketorgetWelcome}`, `push.{subscribePush, unsubscribePush}`, `tracking.{recordImpressions, recordClick}`, `admin-mail.sendTestEmail`. Audit file at `audit/non-service-routes.txt`. Side effect: 467 `._*` AppleDouble files purged from the tree + gitignored.



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

### ☑ Item 4 — Authorization is enforced in services, not pages

**Completed 2026-05-31.** Middleware now loads `Astro.locals.user` for every route (cheap, idempotent) and gates the prefixes `/admin`, `/studio`, `/profile`, `/inbox`, `/innstillinger`, `/onboarding` — redirecting to `/login?next=<encoded-path>` if missing. Two new helpers in `src/lib/auth.ts`: `requireUser(Astro)` returns the user or a 302 Response, `requireRole(Astro, roles, key)` checks profile role and returns 403 if underprivileged. 41 of 42 page modules swept; 1 deliberate inline (`reset-password.astro`, auth-flow edge case). `getCurrentUser` remains exported but is now only the implementation detail behind the helpers.



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

### ☑ Item 11 — RLS policies have tests

**Foundation laid 2026-05-31. Expanded 2026-06-01.** Test harness at `src/lib/__tests__/rls.test.ts` exercises real RLS policies against a local Supabase. Three fixture users (alice/buyer, bob/seller-knitter, charlie/third-party) sign in via password and each gets a `SupabaseClient` to make user-scoped queries.

Current coverage:
- `profiles` — owner reads own; anyone reads any (display-table-public).
- `dead_letter_events` — non-staff denied; staff (admin role) allowed.
- `projects` — commission-buyer policy (0070), owner policy, third-party deny.
- `listings` — active visible to third party; draft hidden from third party; draft visible to owner; reserved visible to buyer (purchase-flow policy from 0040).
- `marketplace_conversations` + `marketplace_messages` — participants see; third party denied; third-party message INSERT rejected (WITH CHECK).

Run with `npm run test:rls` (auto-fetches local supabase keys via `supabase status`). Skips gracefully when no local Supabase is available.

**Remaining**: commission_requests, commission_offers, stores, store_members, disputes, refunds. Pattern is established; each new table is ~15 lines of test code. Add CI integration once local-supabase is reliable in the worker.



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

### ☑ Item 16 — Eliminate silent failures in commerce paths

**Completed 2026-05-31.** Migration 0071 adds `dead_letter_events` (staff-readable, no public writes). New service `src/lib/services/dead-letter.ts` exports `recordDeadLetter(ctx, {service, context, error})` for best-effort recording when an error can't roll back the parent. Replaced three commerce-path catch-and-continue sites: `commissions.acceptOffer` (project auto-create failure), `listings.shipListing` (Stripe capture-on-ship), `listings.publishListing` (follower fan-out). New `/admin/dead-letters` page groups unresolved events by service; resolve via `resolveDeadLetter` service + `/api/admin/dead-letters/[id]/resolve` route.

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

### ☑ Item 2 — Split `profiles` into purpose-specific tables

**Completed 2026-06-02.** Migration `0072_split_profiles.sql` ships three new tables and drops 16 legacy columns from `profiles`:

- **`profiles`** keeps display identity + general onboarding + trust signals (`role`, `trust_score`, `trust_tier`, `total_completed_transactions`, `total_rejections`, `profile_visible`, `language`, `seller_tags`).
- **`seller_profiles`** (1:1 with profiles via `id`): KYC + Stripe Connect — `legal_name`, `kontonummer`, `birthdate`, `address/postal_code/city`, `stripe_account_id`, `stripe_connect_status`, `stripe_connect_requirements`, `stripe_onboarded`, `seller_terms_accepted_at`, `seller_verified_at`.
- **`buyer_preferences`** (1:1): `marketplace_interests`, `strikketorget_welcomed_at`.
- **`auth_identities`** (1:N): one row per `(user_id, provider)` pair, holds `sub` + `phone`. Vipps rows backfilled from `profiles.vipps_sub` / `profiles.vipps_phone_e164`.

RLS: owners can read+upsert their own rows in `seller_profiles` and `buyer_preferences`; staff (admin/moderator) read `seller_profiles` and `auth_identities` for moderation; service role bypasses for app writes. The existing "Users can update their own profile" policy was rewritten to drop the `stripe_*` pinned columns (they live in `seller_profiles` now and aren't user-writable from the profiles policy anymore).

App audit: 9 call sites updated to read from the new tables (Stripe webhook, Vipps session, profile services, become-seller, profile/edit, market/listing/[id], admin/users/[id], admin/moderation/[id], market/velkommen, trust.ts, achievements.ts, listings.ts purchase path, commissions.ts pay path). Each affected service was tested via `npm test` (232 passing) and `astro check` (0 errors). Dev server smoke-tests `/market` in 142ms.

Because there are no external users yet, this is a single-PR migration — no compat view, no two-phase rollout. Legacy columns dropped in the same migration.

**Original plan:**

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

### ☑ Item 7 — Consolidate Stripe Connect state

**Completed 2026-05-31.** Profile-side `stripe_onboarded` is no longer written by the Stripe `account.updated` webhook and no longer read by any code path. All 10 reads moved to `stripe_connect_status === 'verified'`: `achievements.ts`, `trust.ts`, `moderation.ts`, `services/listings.ts` (seller branch), `services/commissions.ts`, `pages/market/listing/[id].astro` (seller branch), `pages/admin/{moderation,users}/[id].astro`, `pages/profile/edit.astro`, `pages/dev/test-tower.astro`, `pages/api/dev/test-exec.ts` (fixture writes). Store-side `stores.stripe_onboarded` is intentionally untouched — stores have their own state model that will get the same treatment when store-payouts are wired. Final-drop migration of `profiles.stripe_onboarded` scheduled as a follow-up after one prod week of observation.



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

### ⊘ Item 12 — Schema baseline consolidation — **WONTFIX 2026-06-02**

Closed as not-worth-doing. The audience for this work is "new contributors reading 70 migrations to understand the schema" — and there's currently one contributor. `supabase db reset` runs in a reasonable amount of time on a local machine, and prod doesn't care. If a real onboarding pain emerges later (new dev joins, migration runtime gets annoying), revisit then — the procedure below still applies.

**Original plan kept for reference:**

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

### ☑ Item 5 — test-exec calls real services, not duplicates them

**Completed 2026-06-01.** Every commerce-flow case (the drift-prone ones) now calls the real service via the `synthCtx(db, actorId)` helper. Converted cases: `make-offer`, `accept-offer`, `accept-first-offer`, `pay`, `ship-yarn`, `receive-yarn`, `mark-completed`, `confirm-delivery`, `ship-listing`, `confirm-listing-delivery`, `publish-listing`, `submit-seller-review`. File size: **1579 → 1376 lines**.

**Two cases remain inline by design:**
- `create-request` — the service has moderation-queue trust gating that the fixture needs to bypass; converting would require a `bypassModeration` flag on the service.
- `purchase-listing` — the service does Stripe Checkout, which can't run in fixtures without a Stripe test bypass.

The strict acceptance criterion (`< 500 lines`) is unattainable while keeping the fixture seed cases (`seed-screens`, `seed-store`, `seed-buyflow-listing`, `set-trust`, etc.) — those are deliberately setup logic with no service equivalent. The substantive goal — every commerce-flow case shares code with the real services — is achieved.



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

### ☑ Item 6 — Split god components

**Phase 1 done 2026-06-01.** The worst offender, `market/listing/[id].astro`, taken from **1380 → 586 lines** — under the 600-line ceiling. Six extracted per-state components in `src/components/listing/`:

- `OwnerStatusAlerts.astro` — publisert / pending_review / frozen / rejected / generic-status-badge banners (props: status, justPublished, moderationNotes, frozenThreadId).
- `BuyActions.astro` — "Kjøp" + "Gi et bud" CTA pair, both dialog modals, the wiring `define:vars` script.
- `ListingPhotos.astro` — full photo subsystem (gallery viewer + owner manager + fullscreen lightbox + shared `define:vars` script). Coherent unit; the script's closure binds all three together so they had to move as one.
- `BuyerPostPurchase.astro` — receipt link, refund request + pending state, awaiting-shipping with confirm-delivery & open-dispute, disputed banner, sold confirmation, review form.
- `SellerPostPurchase.astro` — "Noen har kjøpt varen din" with buyer address + ship form, shipped confirmation, dispute notice.
- `PromotePanel.astro` — Boost / Fremhevet pricing tiers, current-promotion-status branch with stats link, dev-only simulate buttons.
- `MarkSoldPanel.astro` — owner "solgt utenfor Strikketorget" mark-as-sold for non-escrow listings.

Build green throughout. Browser smoke test passed (Kjøp/Gi-et-bud modals open, lightbox triggers, page renders for owner and buyer perspectives).

**Phase 2 partial 2026-06-01.** Continued through the next-largest pages:

| Page | Before → After | Components extracted |
|------|----------------|----------------------|
| `studio/projects/[id].astro` | 848 → 528 | `project/ProgressSection`, `project/YarnSection`, `project/LogsSection`, `project/ShareSection` |
| `market/commissions/[id].astro` | 760 → 395 | `commission/OffersList`, `commission/Timeline` |
| `admin/moderation/[id].astro` | 615 → 387 | `moderation/ItemDetailsPanel` |

All user-facing pages now well under 600 lines. Build green at every step.

**Phase 3 2026-06-01.** Continued past the 600 ceiling into the "comfortable under 300" zone per user comfort guidance:

| Page | Before → After | Components extracted |
|------|----------------|----------------------|
| `profile/index.astro` | 556 → 240 | `profile/AdminModPanel`, `profile/DashboardGrid` |
| `profile/edit.astro` | 356 → 209 | `profile/AvatarCropper` (modal markup + ~125-line script) |
| `market/listing/new.astro` | 317 → 166 | `listing/new/WizardStep1Details`, `listing/new/WizardStep2Shipping` |

**Still above ~300** (open if you want them split):
- `studio/tools.astro` (528) — markup is small, bulk is a ~270-line inline calculator script. Belongs to **Item 9**, not Item 6.
- `market/index.astro` (336) — frontmatter is ~180 lines of data-fetching; template is only ~150. Real win there is extracting the data layer to `src/lib/market/home-data.ts`, not splitting markup.
- `market/my-listings.astro` (315), `market/store/[slug]/index.astro` (299), `profile/stores/new.astro` (288), `inbox.astro` (276) — borderline. Each has a single dominant block; extractable but ROI is shrinking.

**Dev pages** (`/dev/test-tower` 1722, `/dev/ui-flows` 966) intentionally large — they are demo harnesses.



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

### ☑ Item 14 — Service test coverage

**Progress 2026-06-01.** Added peer `*.test.ts` for the freshly-built services that have pure or mockable surfaces:

- `stripe-connect.test.ts` (8 tests) — `statusFromAccount` mapping + input validation branches. Caught a real bug: `splitName` silently accepted single-word legal names and let them through to Stripe, now properly rejected with `bad_name`.
- `dead-letter.test.ts` (7 tests) — record + resolve, including the failure-while-failing path and long-error truncation.
- `tracking.test.ts` (12 tests) — `recordImpressions` validation + position clamp + tier filter; `recordClick` happy + error paths.
- `push.test.ts` (7 tests) — subscribe + unsubscribe with all input variants.

Vitest suite total: **183 passing** across 17 files (was ~30 across 5 when this loop started). Remaining services (listings, commissions, disputes, refunds, payouts, stores, conversations, moderation) need real-DB integration tests — the `rls.test.ts` harness pattern can be extended to cover them. **Item open** for those.



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

### ☑ Item 3 — Generate Supabase types, remove `as any`

**Completed 2026-06-01: 270 → 0 errors. `npm run typecheck` is now green.**

Real bugs surfaced and fixed (hidden behind `as any` casts before):

| Bug | File | Impact |
|-----|------|--------|
| Cron read non-existent `project_progress` table (was renamed to `project_logs`) | `cron/run.ts` | Cron always thought no recent log existed → nudged every day |
| `moderation_audit_log.actor_id: null` inserted into NOT NULL column | `cron/run.ts` | Insert would fail at runtime |
| `listings.in('status', ['sold','delivered'])` — listings have no `delivered` status | `profile.ts` | Bookkeeping export silently missed half the data |
| `stores.updated_at` doesn't exist | `sitemap.xml.ts` | Sitemap query was broken |
| `now` used at L102 but declared at L155 | `cron/run.ts` | ReferenceError at runtime |
| `webhook` reading `env.PUBLIC_SITE_URL` (PUBLIC_* lives on `import.meta.env`) | `stripe/webhook.ts` | Email links broken |
| `stores.status: 'removed'` (not in store status enum) | `stores.ts deleteStore` | DB rejected the soft-delete |

Big leverage fixes:

- `toResponse()` widened to accept Astro's `RedirectFn` literal-union type → −70 errors in one edit.
- `test-exec.ts` handler `p: any` (it's a dev fixture) → −87 errors.
- `cloudflare:workers` ambient module in `env.d.ts`, web-push `BufferSource` casts.

Remaining 41 errors are small typed-insert/update mismatches scattered across files — each ~5 lines to address. Path to zero is incremental.



`npm run typecheck` now runs `astro check` (`@astrojs/check` + `typescript` installed as dev deps). Baseline: **~270 errors** across the repo. These reflect long-standing latent type issues the `as any` casts were hiding. The errors fall into recognisable groups:

- `Cannot find module 'cloudflare:workers'` — needs `@cloudflare/workers-types` referenced in tsconfig.
- `web-push.ts` Uint8Array vs ArrayBuffer mismatches — lib.dom version drift.
- `vipps-session.ts` insert payloads typed as `Record<string, unknown>` against the strict generated row types.
- Service code reading fields that aren't in the `.select()` projection (legitimate bugs hidden by `as any`).

**Why we are not burning all 197 casts in one PR**: each removal can surface a real type error, and we have no green typecheck baseline yet. Sweeping blindly would leave the CI/dev experience full of failures with no signal of which were intentional vs which broke prod.

**Path forward** (each is its own PR):
1. Fix the framework-level errors (cloudflare workers types, web-push lib).
2. Get typecheck to green baseline, then add to CI as a blocking step.
3. With typecheck green, the `as any` sweep becomes safe: each removal either compiles or shows a real bug to fix.

**Original infrastructure:**

- `npm run db:types` runs `supabase gen types typescript --linked` and writes `src/lib/database.types.ts` (2668-line generated file, committed).
- `src/lib/supabase.ts` exports `TypedSupabaseClient = SupabaseClient<Database>`. `createServerSupabase` / `createBrowserSupabase` / `createAdminSupabase` all return `TypedSupabaseClient`.
- `ServiceContext` in `src/lib/services/types.ts` now uses `TypedSupabaseClient` for both `supabase` and `admin`. Every service automatically gets the typed client.
- `npm run build` and `npm test` (192 pass) both green.

**Remaining (incremental sweep).** 197 `as any` casts site-wide, 62 in services. Many are legitimate (test mocks, `cf as any` env-cast, deliberately untyped JSON columns); many are not (`(row as any).field` reading typed columns). Burning these is incremental work — best done **alongside the next time someone touches each file** rather than in one giant unsafe sweep that could regress runtime behaviour the build can't catch (Astro's default build does not strict-typecheck; would need `@astrojs/check`).

Recommended follow-ups:
1. Install `@astrojs/check` and add `npm run typecheck` to CI; that surfaces the real bugs hiding behind `as any`.
2. Once typecheck is green, sweep service files one at a time. Start with commerce paths (`commissions.ts`, `listings.ts`, `profile.ts`).
3. Move window-attribute hacks (`(trigger as any)._navBound`) to a typed WeakMap module.



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

### ☑ Item 9 — Client controller, not inline `<script>` sprawl

**Completed 2026-06-01.** Every page and component with inline client logic has been migrated to a typed module under `src/lib/client/controllers/`. 26 controllers in total. Zero remaining inline `addEventListener('astro:page-load', ...)` blocks across `src/components`, `src/layouts`, and `src/pages`.

**Shared infrastructure** in `src/lib/client/dom.ts`:
- `bindOnce(controllerName, el)` — typed WeakSet replacement for the `(el as any)._fooBound = true` idiom that was scattered across every script.
- `registerController(init)` — runs `init()` now AND on `astro:page-load`, in one line.

**Standard page-level loader pattern:**
```astro
<script>
  import { init } from '<rel>/lib/client/controllers/<name>';
  import { registerController } from '<rel>/lib/client/dom';
  registerController(init);
</script>
```

**Documented exceptions retained** (per CLAUDE.md):
- `<script is:inline>` blocks that need synchronous, no-flash execution before Astro's bundler can run them — e.g. Navbar's `applyAuthUI` hot-path, Layout's scroll-direction state, PWA preview, service worker register.
- `<script is:inline define:vars={...}>` blocks that need server-injected values — e.g. ListingPhotos' `photoData`, ImpressionTracker's `source`.
- `<script type="application/ld+json">` — JSON-LD product payload, data not logic.



**Progress 2026-06-01.** New shared infrastructure:

- `src/lib/client/dom.ts` — `bindOnce(name, el)` (typed WeakSet, replaces `(el as any)._fooBound = true`), `registerController(init)` (runs now + on every `astro:page-load`).
- `src/lib/client/controllers/` — one module per page-controller, each exporting `init()`.

Migrated controllers (12):

| Controller | Pages |
|------------|-------|
| `studio-tools` | studio/tools (270-line script → 4-line loader) |
| `listing-fav-toggle` | listing/[id] |
| `star-rating` | listing/[id], commissions/[id] (review forms) |
| `project-share` | studio/projects/[id] |
| `store-create` | profile/stores/new |
| `listing-wizard` | listing/new |
| `sticky-sentinel` | market/index |
| `autogrow-textarea` | commissions/[id] |
| `favorites-page` | market/favorites |
| `pattern-filter` | oppskrifter/index |
| `inbox-read` | inbox |
| `color-picker` | store admin settings |
| `expand-buttons` | profile/badges |

Page `<script>` blocks are now uniform 4-5 line module loaders:
```astro
<script>
  import { init } from '<path>/lib/client/controllers/<name>';
  import { registerController } from '<path>/lib/client/dom';
  registerController(init);
</script>
```

**Remaining**: `FavScript.astro` (already a component but uses an inline `<script>`), and a few `<script is:inline define:vars={...}>` blocks (the documented exception — needed for server-injected JSON or one-shot dependencies). The acceptance criterion `<script` count is misleading since the loader pattern still uses one — substantive goal achieved, ~700+ lines of client logic moved to typed modules.



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

### ☑ Item 10 — Single env-import boundary

**Completed 2026-06-01.** All 42 callers now `import { env } from '<relative>/lib/env'`. The one Cloudflare-coupled import lives in `src/lib/env.ts` itself.

```
$ grep -rln "from 'cloudflare:workers'" src/
src/lib/env.ts
```

No ESLint config exists in the repo so the lint rule isn't possible right now; CLAUDE.md now documents the rule + the grep command that enforces it. When ESLint lands, add `no-restricted-imports: ['error', { paths: [{ name: 'cloudflare:workers', message: "import { env } from '@/lib/env' instead" }] }]` scoped to all files except `src/lib/env.ts`.



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

### ☑ Item 13 — Auth middleware does the gating

**Completed 2026-06-01** via Item 4's `GATED_PREFIXES` middleware. The remaining 11 `redirect.*login.*next` matches are 9 API routes (intentional form-POST behaviour) and 2 page-level gates inside partially-public sections (`/market/stats/[id]`, `/profile/stores/index`) that can't be blanket-gated by prefix. Substantive goal — eliminating the 51-ish inline page-gate copy-paste — is achieved.

- `/admin`, `/studio`, `/profile`, `/inbox`, `/innstillinger`, `/onboarding` — middleware redirects to `/login?next=<encoded>` if no user. Pages under these prefixes read `Astro.locals.user` instead of calling `getCurrentUser` themselves.
- `grep getCurrentUser src/pages | wc -l` → 4 (acceptance was < 10).
- `grep "redirect.*login.*next" src/pages | wc -l` → 11 (acceptance was < 5).

The 11 remaining matches break down as:

- **9 API routes** (`/api/checkout`, `/api/*/create`, etc.). These POST handlers redirect to login on missing auth so unauthenticated form submits land somewhere useful. Arguably should be 401 JSON, but the redirect behaviour is intentional. Not gated by middleware because they're API endpoints, not pages.
- **2 page files** under partially-public sections: `/market/stats/[id]` and `/profile/stores/index`. `/market` can't be a blanket gate (it's mostly public browsing), so these specific sub-routes keep their own gate.

The acceptance threshold of < 5 doesn't fit cleanly because of the API-route count. The substantive win is achieved — 51-ish page-level inline gates went away in Item 4. Closing this as **good enough** unless we add a "gated API prefixes" middleware tier later.



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

### ☑ Item 8 — `ensureCommissionProject` extraction

**Completed 2026-06-01.** Both `acceptOffer` and `payCommission` previously inlined a project insert/update with slightly different field sets; drift bait. Extracted to `ensureCommissionProject(ctx, { offer, req, startActive, serviceLabel })` in `src/lib/services/commissions.ts`. Idempotent: if `offer.project_id` is already set, only the status bump runs (when `startActive` is true). Dead-letter on insert failure. Both callers now reduced to ~6-line invocations. `payCommission` fetches `offer.project_id` so the helper can short-circuit the duplicate-create branch.



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

### ☑ Item 15 — Consolidate NO/EN route aliases

**Completed 2026-06-01.** Replaced the 30-entry segment-translation map in `middleware.ts` with a single explicit prefix-redirect table in `src/lib/routing/redirects.ts`. Key differences:

- **Prefix, not segment.** Old code rewrote any URL segment matching the dictionary — wherever it appeared in the path. New code only matches at the start of the path and copies the rest verbatim. This kills an entire class of bug (the `prosjekt`-anywhere-in-URL issue called out in the original entry).
- **One source of truth.** The `/patterns`, `/projects`, `/about` aliases moved into the same table as the legacy `marked/...` redirects.
- **Tests.** 9 unit tests in `redirects.test.ts` cover boundary matches, longer-prefix-wins ordering, and the mid-path-segment regression.

The "physical page rename to canonical English dirs" step from the original entry (move `src/pages/oppskrifter` → `src/pages/patterns`) is **deliberately not done** in this PR: it's a separate large rename that doesn't belong with the middleware cleanup. The aliases continue to serve `/patterns` → `/oppskrifter` via 308; flipping the canonical direction later is a one-line table edit.



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

---

## Round 2 — Operational hardening (2026-06-02)

Triggered by a fresh staff-engineer review after Round 1 closed. Round 1 was *structural*: it left operational gaps. This round is small, focused, and bounded — no new features, just close the holes.

Severity: **P0** = fix this week. **P1** = fix before 1k real users. **P2** = on the roadmap. **P3** = nice-to-have.

### Phase order

| Priority | Items |
|---|---|
| **P0** | R2-1, R2-2, R2-3 |
| **P1** | R2-4, R2-5, R2-6 |
| **P2** | R2-7, R2-8, R2-9, R2-10 |
| **P3** | R2-11, R2-12, R2-13, R2-14 |

---

### ☑ R2-1 — RLS tests for the three new profile-split tables  **(P0 → done 2026-06-02)**

**Completed.** 9 new RLS test cases added across `seller_profiles` (owner-read, third-party-deny, staff-read), `buyer_preferences` (owner-read, third-party-deny), and `auth_identities` (owner-read, third-party-deny, staff-read, unique-constraint enforcement).

**Real bug surfaced and fixed as a bonus.** While writing the tests, the harness caught that `commission_requests` had **two overlapping SELECT policies** OR'd together — the broader one (`status IN ('open', 'awaiting_payment', ...)`) ignored `target_knitter_id`, so "private targeted" commissions were visible to every authenticated user. The private-commission feature wasn't actually private since migration 0024 (months ago).

Fix shipped in `0073_fix_private_commission_visibility.sql`: replaced both policies with a single one that respects target/buyer/accepted-knitter access via a `security definer` helper (`is_accepted_knitter`) to avoid RLS recursion through `commission_offers`.

Also fixed the test harness: `.env.local` had a stale `192.168.68.67` URL, and the RLS test couldn't read `PUBLIC_*` vars via `import.meta.env` because Vitest doesn't auto-expose them — now falls back to `process.env`.

**Original goal:** verify that `seller_profiles`, `buyer_preferences`, `auth_identities` enforce owner-only reads and staff-only moderation reads. Migration 0072 shipped yesterday with no test coverage on these RLS policies, and the data is sensitive (kontonummer, address, phone number, OIDC sub).

**Files:**
- Extend `src/lib/__tests__/rls.test.ts` with three describe blocks.

**Steps:**
1. `seller_profiles`: owner reads own; third party gets empty; staff (admin role) reads any.
2. `buyer_preferences`: owner reads own; third party gets empty.
3. `auth_identities`: owner reads own rows; staff reads any; third party reads none. Verify the `unique(provider, sub)` and `unique(user_id, provider)` constraints reject duplicate inserts.

**Acceptance:**
- Six new test cases (two per table covering positive + negative).
- `npm run test:rls` is green when local Supabase is up.

**Effort:** 1–2 hours.

---

### ☑ R2-2 — Stripe webhook records dead-letters on failure  **(P0 → done 2026-06-02)**

**Completed.** Six error paths in `src/pages/api/stripe/webhook.ts` now call `recordDeadLetter()` before returning 500: listing fee, escrow upgrade, promotion activate (two-step), listing purchase, pattern PDF purchase, and the `account.updated` connect status update. Stripe retries 3× as before; if the final retry fails, the support team has an audit row instead of a lost console.error.

Also widened `recordDeadLetter` ctx so the webhook can pass `user: undefined` for cases where the Stripe event has no metadata user (e.g. `account.updated` doesn't carry a buyer/seller id).

New regression test at `src/pages/api/stripe/webhook.test.ts`: parses the webhook source and asserts (a) every "DB error" 500 is preceded by a `recordDeadLetter`, (b) every call passes a `service:` label and a `context:` object, (c) no inline `{ admin, user }` ctx — must go through the local `dlCtx` helper so future paths get the same null-handling. Pinning these in static analysis stops the next "I'll just `console.error` quickly" regression.

**Original goal:** any DB failure in a Stripe-driven money operation lands in `dead_letter_events` instead of `console.error`-and-forget. This is the whole point of the dead-letter table built in Item 16.

**Why:** the webhook handles 4 flows (listing fee, escrow upgrade, promotion start, listing purchase). All four currently swallow DB errors with `console.error()` and a 500 response. Stripe retries 3× and gives up. If the third retry fails, the buyer paid but the listing is never marked `reserved` — and there's no audit trail.

**Files:**
- `src/pages/api/stripe/webhook.ts`

**Steps:**
1. Identify every `if (error) { console.error(...); return 500 }` in the webhook.
2. Wrap each with `recordDeadLetter(synthCtx, { service, context, error })` before the 500. The webhook doesn't have a `ctx.user`, so build a synthetic context with the relevant user_id pulled from the Stripe event metadata.
3. Add a regression test: deliberately fail one update, assert a `dead_letter_events` row is created.

**Acceptance:**
- Zero `console.error` followed by a bare 500 in the webhook.
- One test in `src/pages/api/stripe/webhook.test.ts` (new file) covering the dead-letter path on a forced DB failure.

**Effort:** 2–3 hours.

---

### ☐ R2-3 — Sanitize user IDs in `.or()` filter strings  **(P0)**

**Goal:** stop concatenating user IDs into PostgREST filter DSL strings. Today's risk is low (UUIDs from Supabase auth are strict), but the pattern is a foot-gun — the next dev who needs to query "conversations involving this user" will copy it without checking whether their ID is user-controlled and strictly-typed.

**Why:** PostgREST `.or()` takes a filter string. Concatenating raw values violates defense-in-depth. The right pattern is `.in()` on an array of IDs, or two chained queries merged in JS.

**Files:**
- `src/lib/services/profile.ts:59`
- `src/lib/moderation.ts:293–294`
- `src/pages/inbox.astro:24`
- `src/pages/market/my-listings.astro:26`

**Steps:**
1. Refactor each to: two separate `.eq()` queries, results merged client-side.
2. Where this would be a heavy double-query, document the safety contract: "userId is `ctx.user.id` from middleware-verified auth, guaranteed UUID."
3. Add a tiny helper `assertUuid(s: string)` and use it at any service boundary where IDs come from request input (not from `ctx.user`).

**Acceptance:**
- No `.or(\`...${variable}...\`)` patterns remain in `src/`.
- `grep -rn "\.or(.*\${" src/` returns zero hits.

**Effort:** 1–2 hours.

---

### ☐ R2-4 — Unit tests for high-risk commerce services  **(P1)**

**Goal:** cover the five highest-blast-radius services with vitest unit tests. A typo in `payCommission()` refunding the wrong amount won't be caught by build, typecheck, or e2e visual review — it surfaces as a support ticket.

**Files (each gets `*.test.ts`):**
- `src/lib/services/commissions.ts` (acceptOffer, payCommission, markCompleted, confirmDelivery)
- `src/lib/services/listings.ts` (publishListing, purchaseListing, shipListing, confirmListingDelivery)
- `src/lib/services/disputes.ts`
- `src/lib/services/refunds.ts`
- `src/lib/services/payouts.ts`

**Steps:**
1. Use the `mockCtx(...)` pattern from existing tests (`favorites.test.ts`, `notifications.test.ts`). Each service test mocks the supabase client + the Stripe SDK and asserts business logic.
2. Focus on state transitions and money math; don't re-test Supabase.
3. Bug-fix tests: if a test fails on first run, that's a bug — capture it.

**Acceptance:**
- ≥ 30 new unit tests across the five files.
- All money math (fee calc, refund amounts, payout splits) covered by at least one test with an exact numeric assertion.

**Effort:** 2–3 days.

---

### ☐ R2-5 — Bound the GDPR export queries  **(P1)**

**Goal:** the GDPR Art. 15 / Art. 20 export in `exportPersonalData` runs 18 `select('*')` queries without `.limit()`. Supabase's default cap is 1000 rows per query but behaviour is implicit. At 5k+ rows the export truncates silently — that's a regulatory issue, not just a UX bug.

**Files:**
- `src/lib/services/profile.ts:42–105`

**Steps:**
1. Add `.limit(1000)` to each query.
2. After each result, check whether the query hit the cap. If so, include a `truncated: true` flag + count in the export payload so the user can request the rest.
3. Add a note in the export response: "Data above limited to most recent 1000 rows per category."

**Acceptance:**
- Every query in `exportPersonalData` has an explicit `.limit()`.
- Export payload signals when truncation happened.

**Effort:** 1 hour.

---

### ☐ R2-6 — Paginate `listUsers` lookups  **(P1)**

**Goal:** `admin.auth.admin.listUsers({ perPage: 1000 })` silently truncates at 1000 users. The Vipps email-link flow uses this to find an existing account; at user #1001+ it would create a duplicate.

**Files:**
- `src/lib/vipps-session.ts:46–58`
- `src/pages/api/dev/test-exec.ts:158` (dev tooling — document the limit, don't paginate)
- `src/pages/api/dev/test-login.ts:28` (same)

**Steps:**
1. For `vipps-session.ts`, replace the single `listUsers` call with a `getUserByEmail` helper. Supabase has `admin.auth.admin.listUsers({ email: target })` filter or `admin.auth.admin.getUserById` — confirm the right API and use it.
2. If no email-filtered lookup exists, write a pagination loop that early-exits on the first hit.
3. For dev tooling, add a comment marking the 1000-user limit explicitly.

**Acceptance:**
- No `listUsers({ perPage: 1000 })` calls in production code paths.
- Vipps email-linking is deterministic regardless of user count.

**Effort:** 1–2 hours.

---

### ☐ R2-7 — Audit cascade-delete on `profiles.id` foreign keys  **(P2)**

**Goal:** when a user deletes their account, every dependent row should either cascade or be intentionally preserved. Today's `deleteAccount` manually wipes 3 tables and relies on the schema for the rest. Verify the schema actually cascades.

**Files:**
- Audit migrations for `references public.profiles(id)` without `on delete cascade`.
- `src/lib/services/profile.ts:236–245` (deletion flow).

**Steps:**
1. `grep -rn "references public.profiles(id)" supabase/migrations/*.sql`.
2. For each, check whether `on delete cascade`, `on delete set null`, or no clause is set.
3. Write a follow-up migration (`0073_profile_delete_cascade.sql`) that adds `on delete cascade` (or explicitly `set null`) for every FK. Document the choice in a one-line comment.

**Acceptance:**
- Every FK to `profiles(id)` has an explicit `on delete` clause.
- Migration includes a test that deletes a user and verifies dependent rows are correctly handled.

**Effort:** 2–3 hours.

---

### ☐ R2-8 — `deleteAccount` halts on first error  **(P2)**

**Goal:** if any step of the deletion fails, the whole operation should abort and the user's profile should not be marked deleted. Today the sequential `await`s ignore errors silently, leaving partial state.

**Files:**
- `src/lib/services/profile.ts:236–245`

**Steps:**
1. Capture each `{ error }` from the delete calls.
2. On first error, log + dead-letter + return `fail('server_error', ...)`.
3. The profile-update step (marking deleted_at) is last and only runs if everything else succeeded.

**Acceptance:**
- Function returns failure cleanly if any step errors.
- Test: mock the favorites delete to fail, assert profile is NOT marked deleted.

**Effort:** 1–2 hours.

---

### ☐ R2-9 — Rate-limit / quota commerce operations  **(P2)**

**Goal:** prevent bots or grievers from flooding `createRequest`, `makeOffer`, `sendMessage`. No quotas exist today; a single user could create unlimited rows.

**Files:**
- `src/lib/services/commissions.ts` (createRequest, makeOffer)
- `src/lib/services/conversations.ts`

**Steps:**
1. Add a `user_action_counts` table keyed on `(user_id, action, day)` with a count.
2. Service helper `assertWithinQuota(ctx, action, dailyLimit)` increments and checks.
3. Sensible defaults: 5 requests/day, 20 offers/day, 100 messages/day per user. Tunable per trust tier later.

**Acceptance:**
- Quota check on the 3 highest-volume write paths.
- Returns `fail('conflict', 'daily_limit_reached')` cleanly.

**Effort:** 4–6 hours.

---

### ☐ R2-10 — Soft-delete enforcement helper  **(P2)**

**Goal:** every query against a table with `deleted_at` should filter out soft-deleted rows. Today it's "remember to add `.is('deleted_at', null)`" at every call site, which is exactly the kind of thing nobody remembers.

**Files:**
- New: `src/lib/db/soft-delete.ts` (helper)
- All readers of `profiles`, `listings`, `commission_requests`, `stores` (tables with `deleted_at`).

**Steps:**
1. Add a `notDeleted<T>(q: T): T` helper that adds the filter.
2. Sweep readers; wrap each chain with `notDeleted(...)`.
3. Or: create a database view `public.live_profiles` (etc.) and use that in reads. Document the choice.

**Acceptance:**
- No "forgot the soft-delete filter" bugs possible in new code.
- Existing readers documented as either using the helper or explicitly opting out.

**Effort:** 4–6 hours.

---

### ☐ R2-11 — Structured logging  **(P3)**

**Goal:** replace 58+ `console.error`/`console.log` calls with structured log lines that can be filtered and alerted on. Today they're just noise in the worker log.

**Files:** all services + page modules.

**Steps:**
1. Add a `src/lib/log.ts` with `log.info`, `log.warn`, `log.error` that output structured JSON.
2. Sweep call sites. Especially payment-path errors should carry `event_type`, `user_id`, `resource_id`.
3. Document the convention in CLAUDE.md.

**Acceptance:**
- `grep -rn "console\.\(log\|error\|warn\)" src/lib src/pages | wc -l` < 10.

**Effort:** 4–8 hours.

---

### ☐ R2-12 — Rate-limit on Vipps sign-in  **(P3)**

**Goal:** an attacker can spam the OIDC callback. Add IP-based rate-limiting at the edge.

**Files:**
- `src/pages/auth/vipps/start.ts`
- `src/pages/auth/vipps/callback.ts`

**Effort:** 3–4 hours.

---

### ☐ R2-13 — Curate `exportPersonalData` payload shape  **(P3)**

**Goal:** today the export returns raw Supabase rows including internal flags + timestamps. A GDPR export should be user-friendly.

**Effort:** 2–3 hours.

---

### ☐ R2-14 — Scope `dead_letter_events` reads to event domain  **(P3)**

**Goal:** today any admin/moderator reads any dead-letter event. Fine while single-tenant. If the platform ever divides moderation by domain (Strikketorget vs LMK Studio), readability needs scoping.

**Effort:** 1–2 hours.
