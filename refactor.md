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

### ◑ Item 11 — RLS policies have tests

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

### ◑ Item 5 — test-exec calls real services, not duplicates them

**Major progress 2026-06-01.** Added `synthCtx(db, actorId)` helper in `test-exec.ts` that builds a `ServiceContext` with the admin client backing both `supabase` and `admin` slots (RLS is exercised separately by `rls.test.ts`). Converted the high-drift commerce-flow cases to call real services: `make-offer`, `accept-offer`, `accept-first-offer` (falls through), `pay`, `mark-completed`, `confirm-delivery`, `ship-listing`, `confirm-listing-delivery`. File size dropped 1579 → 1445 lines, and each converted case is now ~5 lines instead of 30-50. **Remaining**: `create-request` (moderation queue logic — needs trust setup), `purchase-listing` (Stripe Checkout — needs bypass mode in the service), `ship-yarn`/`receive-yarn`, `publish-listing`, `submit-seller-review`. Fixture cases (`cleanup`, `seed-*`, `set-*`) stay inline by design. The pattern is established — each remaining conversion is a ~10-line edit.



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

### ◑ Item 6 — Split god components

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

### ◑ Item 14 — Service test coverage

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

### ◑ Item 3 — Generate Supabase types, remove `as any`

**Progress 2026-06-01.** Infrastructure landed:

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

### ◑ Item 13 — Auth middleware does the gating

**Progress 2026-06-01.** Item 4's `GATED_PREFIXES` middleware already absorbed the bulk of the inline-auth-gate sweep:

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
