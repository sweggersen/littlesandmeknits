# June 2026 — Launch-readiness plan (v2)

**Created:** 2026-06-03 · **v2:** hardened after a staff-engineer review (see §6 for what changed)
**Owner:** Sam (solo) · **Basis:** gap analysis of `docs/BUSINESS_PLAN.md` §3.2 vs the live codebase. The business plan is dated May 2026 and is **stale** — many 🔴 "must-haves" already shipped. This file is the corrected, actionable list. When an item lands, tick it and update `BUSINESS_PLAN.md` in the same PR.

Legend: **P0** launch-blocker · **P1** before public launch · **P2** polish/post-launch · Status ☐ todo ◐ partial ☑ done.

> **Reality of capacity:** one person. Treat the §5 sequence as serial, not parallel. The two long poles (VAT legal loop, ops/CI) must START in week 1 even though they finish later.

---

## A. What "launched" means — go/no-go gates

Two distinct bars. Don't blur them.

### Soft launch (invite-only, ≤50 users) — minimum bar
- [ ] Payments money-flow failure modes handled (§1.2) and a **payments kill-switch** exists (§1.4).
- [ ] Migration delivery is reliable + drift-checked (§1.3); prod RLS verified == migrations (incl. 0080 applied, §1.8).
- [ ] Error tracking live (§1.7) so we *see* failures.
- [ ] Seller can self-onboard to a first listing without a dead-end (§1.5).
- [ ] Legal pages reviewed by a lawyer for the escrow/fee/data flows (§0 + §1.1).

### Public launch — additional bar
- [ ] VAT correct + accountant sign-off (§1.1).
- [ ] T&S minimum: chargeback/fraud/prohibited+illegal-content handling (§2.1).
- [ ] Accessibility pass (§2.2). Staging + CI gate + auto-deploy (§1.3). Product analytics (§1.7).

### Quantified gates (fill in real numbers before opening)
- p75 LCP < 2.5s on listing + browse pages; checkout success ≥ 98%; webhook processing error rate < 0.5%; zero unhandled money-flow events in a 50-transaction soft-launch.

---

## 0. Correct the stale docs first (P0, ~1h)

- [ ] `BUSINESS_PLAN.md` §3.1/§3.2 + `MARKETPLACE-READINESS.md`: reconcile to reality; re-date.
- **Verified DONE (don't rebuild):** Cookie banner (wired) · GDPR export+delete (`/profile/data`) · Help center (`/hjelp` + subpages) · Receipts (`kvittering`) · Vipps login + Vipps Checkout method · SEO sitemap + per-item OG/Twitter cards · Bokføring export API · ~500 tests incl. 99% money-path mutation gate + real-Postgres integration.
- **NOT actually done (correct my earlier shallow check):** privacy/terms *exist* with content but are **not legally reviewed** — that's the real gate, not file length. Keep them in §1.1.

---

## 1. Pre-launch blockers (P0)

### 1.1 VAT + merchant-of-record + legal review — the launch gate
**Why deeper than a column:** purchases and commissions use **Stripe destination charges** (`transfer_data.destination` + `application_fee_amount`), so the **platform is merchant-of-record**. Under NO/EU marketplace rules this risks making us the *deemed supplier* — liable for VAT on the **full sale**, not just our fee. For C2C used-goods (the wedge) that's likely wrong. This may force **separate charges** (seller = MoR) for private sellers vs destination charges for registered `Butikker`. Architecture decision, not a label.
**Work:**
- [ ] Tax-lawyer/accountant: confirm MoR + deemed-supplier status per transaction shape (Brukt C2C / Nytt / Strikk for meg / Butikker). Decide charge model per shape.
- [ ] If needed, implement **separate charges** path for private sellers; keep destination charges for VAT-registered stores.
- [ ] VAT engine: 25% output VAT on the **platform fee** (always); sale VAT only where the seller is VAT-registered. Persist `vat_nok`/`vat_rate` on the order; show real VAT line on `kvittering`.
- [ ] Bokføring/Skatteetaten export includes VAT columns + sequential invoice numbers (Bokføringsloven).
- [ ] Lawyer review of `/privacy` + `/terms` + `/om` against the actual escrow/fee/refund/data-processing flows. (Content exists; correctness/sign-off is the gate.)
**Acceptance:** accountant signs off; a purchase produces a compliant receipt with correct VAT; charge model documented per transaction shape.
**Effort:** L+ (legal loop is the long pole — start week 1). **Owner-action:** book accountant now.

### 1.2 Payments money-flow failure-mode hardening (NEW — highest-risk subsystem) — ☑ DONE 2026-06-03
**Why:** webhook handles only `checkout.session.completed` + `account.updated`. **No** handlers for chargebacks/refunds/payout-failures/failed-payments. Chargeback after payout = silent loss; failed payout = seller silently unpaid; day-14 auto-release `capture()` only `try/catch`-logs — failed capture means the seller is never paid with no recovery.
**Work:**
- [x] Handle `charge.dispute.created` → freeze item to `disputed` (auto-surfaces in `/admin/disputes`), notify seller; `.closed` → record won/lost + notify. → `handleChargebackOpened`/`handleChargebackClosed` in `src/lib/services/stripe-events.ts`.
- [x] Handle `payout.failed` → dead-letter + notify mapped seller. → `handlePayoutFailed`. (`payout.paid` left as no-op; nothing actionable.)
- [x] Handle `payment_intent.payment_failed` → dead-letter with matched escrow. → `handlePaymentIntentFailed`.
- [x] Auto-release cron: on capture failure, **don't mark delivered/sold** (leave `auto_release_at` past-due so next tick retries) + dead-letter. → `cron/run.ts` both passes.
- [x] Refund-after-payout reconciliation: `charge.refunded` flags a dead-letter when the row was already released (`status='sold'`), records refund outcome, notifies buyer. → `handleChargeRefunded`.
- [x] Webhook idempotency by event id → `stripe_webhook_events` ledger; recorded only after a 200 so a post-500 retry still reprocesses. Webhook refactored into `handleEvent` with dedup wrapper.
- [x] Tests: `src/lib/services/stripe-events.test.ts` (12 cases, fake-db). Full suite 519 green; build clean.
- [ ] **Owner action:** enable these events on the Stripe webhook endpoint (Dashboard → Developers → Webhooks): `charge.dispute.created`, `charge.dispute.closed`, `payout.failed`, `payment_intent.payment_failed`, `charge.refunded`. And apply migration `0081` (see §1.8 batch).
**Acceptance:** ✅ each event type has a handler + test; simulated chargeback and failed payout both freeze/notify and land a tracked outcome.
**Effort:** M–L (done in ~1 day).

### 1.3 Reliable migration delivery + schema-drift CI gate (NEW — proven-fragile) — ☑ CODE DONE 2026-06-03 (secrets = owner action)
**Why:** evidence of breakage — `0038` partially applied to prod; `0077` broke anon browse. Process is manual dashboard-paste (non-transactional). This *will* recur.
**Work:**
- [x] `deploy` job (master only): `supabase db push` (transactional) → `wrangler deploy`. Stops manual paste + laptop deploys. → `.github/workflows/ci.yml`.
- [x] `database` gate job: `supabase start` applies **every migration from scratch** (a broken/partial migration fails here, not prod) → `db lint` → no-drift check (`db diff --local` must be empty) → RLS + integration tests against the real Postgres.
- [x] `quality` gate job: `typecheck` + unit tests + `build`. PRs blocked on red. (Mutation gate kept as a local/manual `npm run test:mutation`, not on every PR — it's slow; run on money-path changes.)
- [ ] **Owner action:** add repo secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`); each deploy step self-skips until its token is set. If a branch-protection rule pins the old check name `build`, repoint it to `quality` + `database`.
**Acceptance:** ✅ migrations reach prod only via `db push` in CI; fresh-apply + drift + RLS gate every PR. Pending: secrets so the deploy job is live.
**Effort:** M (code done; ~30 min of secret setup remains).

### 1.4 Incident response: payments kill-switch + rollback + flags (NEW) — ☑ DONE 2026-06-03
**Why:** no staging + manual deploy + no off-switch = a bad release has no recovery path. Confirmed: no feature flags, no kill-switch.
**Work:**
- [x] Runtime **kill-switch** env flags: disable new purchases / payouts / commissions independently → `src/lib/flags.ts` (`killGuard`/`isKilled`), read live from the Cloudflare runtime binding so a dashboard flip takes effect next request. Guards in `listings.ts` (purchase, ship-capture skip, confirm-delivery), `commissions.ts` (payCommission, confirmDelivery), `promotions.ts`, `checkout.ts`, and both `cron/run.ts` auto-release passes. New `service_unavailable`→503 code.
- [x] Minimal feature-flag mechanism (env-backed) → `isFeatureOn('name')` reads `FLAG_<NAME>`.
- [x] Rollback runbook (deploy revert, migration revert, incident checklist) → `docs/INCIDENT_RUNBOOK.md`.
- [x] Tests: `src/lib/flags.test.ts` (9 cases); full suite 507 green; build clean.
**Acceptance:** ✅ flipping a switch returns 503 + a Norwegian pause message on the next request; escrow stays held under `KILL_PAYOUTS`; documented rollback steps.
**Effort:** S–M (done in ~½ day).

### 1.5 Seller onboarding — dead-ends fixed ☑; visual wizard/template deferred (design check)
**Finding (2026-06-03):** the original "bare Stripe Connect wall" premise was **overstated**. It's Stripe **Custom** Connect — all KYC is collected in our own `/profile/become-seller` form (no hosted-onboarding redirect), and `/market/my-listings` already CTAs to new-listing. The genuine gaps were two **dead-ends**, now fixed:
- [x] Post-submit no longer dumps the seller back on the form: `?submitted=1` shows a success state with "Lag din første annonse" + photo-tips link (`become-seller.astro`). Verification continues async via the `account.updated` webhook.
- [x] `listing/new.astro` now guides a non-verified seller (warning + link to set up payouts; soft "verifying in background" note when pending) instead of a silent dead-end at sale time.
- [x] **First-listing templates** (design-approved 2026-06-03): the wizard's single "Fyll inn et eksempel" became three chips — **Brukt barneplagg / Nystrikket plagg / Tomt ark** — that prefill the form. Presets extracted to a pure, unit-tested `src/lib/listing-templates.ts` (guards category/kind/condition against server validation). Photo-tips upgraded to a 3-point callout on the `/foto` step.
**Acceptance:** ✅ signup → seller → first listing has no dead-ends; first-timers get a guided start with valid prefilled data. **Effort:** done (~1 day total).

### 1.6 Welcome emails + deliverability — ☑ DONE 2026-06-03
**Finding:** the welcome email was **already built** (`renderWelcomeEmail`, wired into `auth/callback` first-login, idempotent via `welcomed_at`) — the doc was stale. Remaining gaps closed:
- [x] **Seller-activated** email + in-app notification when Connect verification completes — fired on the *transition* to verified in the `account.updated` webhook (reads prior status so it doesn't re-fire). New `seller_activated` notification type (migration `0082`) + `email-templates.ts` entry.
- [x] **payout_failed** email template (the §1.2 handler now has matching email copy). Added `payout_failed`/`payment_failed`/`seller_activated` to the `NotificationType` union + `EMAIL_PREF_COL`, and **regenerated `database.types.ts`** from local (the proper fix vs `as any` — also surfaced + fixed latent type errors `astro build` had missed but `astro check` catches).
- [x] Tests: `src/lib/email-templates.test.ts` (6 cases; first tests this module ever had). Suite 525 green; typecheck 0 errors; integration/RLS 29 green.
- [ ] **Owner action:** SPF + DKIM + DMARC on `littlesandme.no` → `docs/EMAIL_DELIVERABILITY.md`. (first-sale celebratory email skipped — the sold notification already emails the seller.)
**Acceptance:** ✅ templates built + tested + wired; inbox placement pending DNS.
**Effort:** S (done in ~½ day).

### 1.7 Observability: errors + perf + product analytics — ☑ DONE 2026-06-03 (gated on env)
**Why:** flying blind. No Sentry, no Web Vitals, no funnel analytics.
**Work:**
- [x] **Error tracking** → `src/lib/observability.ts`: Sentry envelope HTTP API via fetch (no SDK dep, Workers-native), gated on `SENTRY_DSN` read from the live runtime binding. Wired into `recordDeadLetter`, so every money-path failure (§1.2) also pages Sentry. Pure DSN-parse + envelope-build unit-tested.
- [x] **Product analytics** → privacy-respecting script (Plausible/Umami) injected in `Layout` head, gated on `PUBLIC_ANALYTICS_SRC`/`PUBLIC_ANALYTICS_DOMAIN`. No cookies → GDPR-clean.
- [x] **Web Vitals** → `controllers/web-vitals.ts`: native PerformanceObserver for LCP/CLS/INP, reported as Plausible custom events (no-ops without analytics). Once per hard load.
- [ ] **Owner action:** set `SENTRY_DSN` (secret) + `PUBLIC_ANALYTICS_SRC`/`PUBLIC_ANALYTICS_DOMAIN` (e.g. a self-hosted Plausible). Until then everything no-ops.
**Acceptance:** ✅ error→Sentry (via dead-letter), slow page→Web Vitals event, funnel→analytics — all activate on env. Tests green (535); typecheck 0; build clean.
**Effort:** M (done in ~1 day).

### 1.8 Apply pending migrations to prod + verify RLS == migrations (carryover) — OWNER ACTION
Both migrations are validated against local Postgres (idempotent, objects present, RLS on). Applying to **prod** is an owner action (dashboard/linked CLI):
- [x] Apply `0080_fix_anon_profile_policy_reads.sql` (fixes anon-browse 403 from 0077). ✅ 2026-06-04
- [x] Apply `0081_stripe_failure_events.sql` (§1.2 dedup ledger + dispute correlation + enum values). ✅ 2026-06-04
- [x] Apply `0082_seller_activated_notification.sql` (§1.6 seller-activated enum value). ✅ 2026-06-04
- [ ] Apply `0083_support_requests.sql` (§2.3 contact-form table + RLS). Validated locally 2026-06-04.
- [x] Apply `0084_delivery_modes.sql` (listings.can_meet; Kan sendes/Kan møtes). ✅ 2026-06-05
- [ ] **STILL OPEN — enable the 5 §1.2 event types on the Stripe webhook endpoint** (Dashboard → Developers → Webhooks → your endpoint → "Select events"): `charge.dispute.created`, `charge.dispute.closed`, `payout.failed`, `payment_intent.payment_failed`, `charge.refunded`. Until this is done the new handlers are deployed but Stripe never delivers those events to them.
- [ ] Verify `supabase db diff --linked` is empty (confirms prod schema == migrations).
**Effort:** XS. **Note:** until 0081 is on prod the webhook still works (dedup degrades to a no-op via the existing idempotent guards); the new failure-mode handlers need the table + columns to persist state.

---

## 2. Before public launch (P1)

### 2.1 Trust & Safety minimum (pulled forward from P2)
A public payments marketplace can't open without: chargeback/fraud handling (ties to §1.2) · seller-payout velocity/anomaly caps (extend the existing quota system) · prohibited-items policy + enforcement · **Norwegian illegal-content reporting obligation** · buyer/seller block list · a 1-page moderator T&S runbook.

### 2.2 Accessibility pass (WCAG AA) — ◐ first pass done 2026-06-04
- [x] **prefers-reduced-motion** — global `@media` kills View Transition animations + transitions + smooth scroll; wizard JS scroll honours it too (WCAG 2.3.3).
- [x] **Contrast** — the small BRUKT/NYTT/OPPDRAG labels were ~3.6–3.8:1 (AA-large-only); darkened each category colour to clear 4.5:1 (Brukt #915f3a, Nytt #5d6f4b, Oppdrag #6f5494), applied to cards + headers + nav pills. Titles/body already pass.
- [x] **Lightbox focus** — focus moves to close button on open, restores to the trigger on close (already had role=dialog/aria-modal/ESC/arrows/scroll-lock).
- [x] **Icon buttons** — favourite heart got aria-label + aria-pressed (+ kept in sync on toggle); toolbar/search/gallery buttons were already labelled. Images already carry alt (decorative = `alt=""`).
- [ ] **Remaining (needs a browser + axe):** full keyboard-nav sweep + visible-focus-ring audit, focus-trap on the remaining modals/menus, and an automated axe scan across the main flows. Best done in CI/browser, not by static reasoning.

### 2.3 Others
- [x] **Admin observability → trends** ✅ 2026-06-04 — `/admin` now shows 7d/30d GMV, platform revenue, items sold, new signups, a 7-day sales sparkline, and a snapshot (active listings, open disputes, unresolved dead-letters). Service `admin-stats.ts` + tests.
- [x] **Contact/support form** ✅ 2026-06-04 — chose a dedicated `support_requests` table (moderation_threads didn't fit a generic contact-us) + `/admin/support` staff inbox + open-count on the dashboard. Form on `/hjelp` (mailto fallback for logged-out). Migration `0083` (owner: apply to prod).
- [ ] Partial refunds + reason picker.
- [◐] `/om` — NOT a stub after all: `AboutContent.astro` already has polished nb+en founder copy. Only gap: the `[navn]`/`[name]` placeholder in the intro (founder's first name to fill; the *designer byline* stays "Weggersen Design"). Owner input.
- [ ] Phone surfacing (Vipps already returns verified phone).

### 2.4 Image delivery (cost + perf)
Photo-heavy app serves full-size images straight from Supabase storage → egress cost + poor LCP. Route through Cloudflare Images / a transform (thumbnails on cards, full on detail). Ties to the §A LCP gate.

### 2.5 DECISION NEEDED — seller reimbursement / clawback on post-payout refunds
**Why now:** §1.2 added `charge.refunded`-after-payout reconciliation that currently only **dead-letters** (flags for support) when a refund lands after escrow was released — because a Stripe refund post-payout can drive the connected account negative, and we have no policy to recover it. We need to decide the actual policy before public launch.

**Verified competitor model (Tise, 2026-06-03):** Tise decides disputes **unilaterally** (seller submits evidence, but *"our support team… will make a determination on the outcome"* — no arbitration/appeal), and **claws the money back from the seller**: *"If Tise determines that a buyer is entitled to a refund and issues a refund to the buyer on the seller's behalf, Tise may seek reimbursement from the seller by invoice, or by collecting the amount… If reimbursement is unsuccessful, we reserve the right to seek reimbursement through other means."* Payout timing is per-sale, ~1–5 business days after the buyer receives (not weekly batching). Sources: tise.com/terms/tise-payment, tise.com/policies/buyer-protection.

**Options to decide:**
- **(a) Avoid the problem (default today):** our 7-day Stripe payout delay (`delay_days: 7`) + 14-day escrow auto-release mean most disputes resolve *before* funds leave the platform, so a true post-payout refund is rare. Keep escrow as the primary protection; only the long-tail (refund after release) needs a policy.
- **(b) Tise-style clawback:** add terms allowing reimbursement-by-invoice / balance-collection from the seller for refunds issued after payout, + the mechanism (Stripe negative balance, or a `seller_debts` ledger). Needs the Terms/Vilkår update (ties to §1.1 legal review) and likely a tax-lawyer check.
- **(c) Platform-absorbs:** eat the rare post-payout refund as a cost; cap exposure via the price ceiling (5 000 kr) + trust gating. Simplest, but unbounded if abused.

**Recommendation:** (a)+(c) for launch (escrow already covers the common case; absorb the rare tail under the 5 000 kr cap), revisit (b) if post-payout refunds become non-trivial in the dead-letter data. Decide with the accountant during §1.1.
**Also:** align the become-seller payout copy with reality — it says "1–5 virkedager" but the Connect config delays payouts 7 days (`stripe-connect.ts`). Fix copy or config.

### 2.6 Helthjem shipping integration — RESEARCHED 2026-06-08, awaiting quote
Evaluate adding **Helthjem** as a (cheaper, home-delivery) shipping carrier alongside/instead of the current Posten tiers (`SHIPPING_TIERS` in `src/lib/shipping.ts`).
- **API:** yes — REST developer portal (developer.helthjem.no). OAuth2 client-credentials (`api.helthjem.no/auth/oauth2/v1/token`) → bookings (`/parcels/v1/bookings`) → label (PDF) → tracking (`/parcels/v1/tracking/fetch/`) + find-service-points + check-coverage. **Structurally identical to our `bring.ts`** (book → label → track), so the code is a mirror of that service.
- **Pricing (researched):** marketplace/volume rate ≈ **38 kr** small parcel (Finn "Fiks ferdig" uses Helthjem; cheapest C2C option vs Posten 50 / PostNord 39–59); standard self-serve ≈ **80 kr** under 5 kg home delivery, ≈ **139 kr** if outside coverage → PostNord pickup. Free insurance to 2 500 kr. Flat within "mailbox size" (~35×25×12 cm, ≤5 kg) — fits baby knitwear; bulky blankets may bump to the pickup tier. Cheaper than our current 76 kr Norgespakke liten, with evening door delivery. **B2B rate is quote-only (no public list).**
- **Access gate (not technical):** must be an existing Helthjem customer → sign up at helthjem.no/bli-kunde + email integrations@helthjem.no for credentials. **Quote requested 2026-06-08.**
- [ ] **Awaiting:** quote + API credentials + sandbox availability (asked: sandbox? marketplace booking on behalf of sellers under one account? label format PDF/ZPL? weight/size limits).
- [ ] When creds land: scaffold env-gated `src/lib/helthjem.ts` (mirror `bring.ts`, `HELTHJEM_*` env), add Helthjem `SHIPPING_TIERS` entry, wire into the mark-shipped flow (book → store label + tracking), test vs sandbox; decide replace-vs-augment Posten.

---

## 3. Polish / post-launch (P2)

Saved searches + alerts · weekly digest · listing variants (size/color) · named wishlists · bulk store CSV import · vacation mode · custom slug change · store collections · milestone (split) commission escrow · photo-update nudges · yarn-order integration · recommendation tuning (use view/impression signal) · referral program · public studio profiles · KYC escalation at volume · Klarna for high-value commissions.

---

## 4. Risk register (additions beyond the business plan)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| VAT deemed-supplier liability on full C2C sales | Medium | **High** | §1.1 MoR analysis; separate charges for private sellers; pause public launch until signed off |
| Chargeback / failed payout silently loses money | **High** (will happen) | High | §1.2 webhook handlers + reconciliation |
| Next partial/failed migration breaks prod | Medium | High | §1.3 CI push + drift gate |
| Bad deploy, no off-switch | Medium | High | §1.4 kill-switch + rollback runbook |
| Solo-founder bandwidth | **High** | High | Cut to the §A soft-launch minimum; serialize §5 |

---

## 5. Realistic sequence (start the long poles day 1)

| Week | Focus | Items | Long-pole kicked off |
|------|-------|-------|----------------------|
| 1 | Don't-lose-money foundation | §0 docs, §1.8 apply 0080, §1.4 kill-switch, §1.2 webhook handlers (start) | **Book accountant (§1.1)**, open Sentry/Supabase-Pro accounts |
| 2 | Ship-safely foundation | §1.3 CI + db push + drift gate + staging, §1.7 Sentry/Web Vitals | accountant loop continues |
| 3 | Supply + correctness | §1.5 seller onboarding, §1.6 welcome emails+DKIM, §1.2 finish | §1.1 VAT implementation as legal answers land |
| 4 | Soft-launch readiness | §A soft-launch gate review; §2.3 quick wins; E2E pass; legal review of pages | — |

Public-launch items (§1.1 finish, §2.1 T&S, §2.2 a11y) land after soft-launch validates the core.

**Recommended first task:** §1.4 kill-switch + §1.2 webhook handlers (protect money first), and in parallel *book the accountant* — VAT is the gating long pole.

---

## 6. What the staff-engineer review changed (v1 → v2)
- Added explicit **launch gates** + soft-vs-public split (§A) — v1 had no definition of done.
- Re-scoped **VAT** from "add a column" to an **architecture+legal** decision (merchant-of-record / deemed supplier) (§1.1).
- Added **payments failure-mode hardening** (§1.2) — webhook handles 0 of chargeback/refund/payout/failed-capture.
- Promoted **reliable migration delivery + drift gate** to P0 (§1.3) — proven fragile (0038 partial, 0077 incident).
- Added **incident response / kill-switch / rollback** (§1.4).
- Pulled **T&S minimum** + **accessibility** to P1 (§2.1–2.2); added **image-delivery** cost/perf (§2.4).
- Added **product analytics + email deliverability** (§1.6–1.7).
- Corrected the v1 error of marking legal pages "done" by line count — **legal review** is the gate.
- Made the **timeline serial** for a solo founder and front-loaded the long poles.
