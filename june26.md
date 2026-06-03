# June 2026 — Launch-readiness plan

**Created:** 2026-06-03
**Owner:** Sam
**Basis:** Gap analysis of `docs/BUSINESS_PLAN.md` §3.2 cross-checked against the live codebase. The business plan is dated May 2026 and is **stale** — many of its 🔴 "must-haves" already shipped. This file is the corrected, actionable list of what's *actually* left. When an item lands, tick it here and update `BUSINESS_PLAN.md` in the same PR.

Legend: **P0** launch-blocker · **P1** before public launch · **P2** polish / post-launch.
Status: ☐ todo · ◐ partial · ☑ done.

---

## 0. Correct the stale docs first (P0, ~1h)

The plan would have us rebuild things that exist. Before any feature work, reconcile it so it stops lying.

- [ ] `BUSINESS_PLAN.md` §3.1/§3.2: move to "shipped" the items verified done below; re-date to 2026-06.
- [ ] `MARKETPLACE-READINESS.md`: same.

**Verified already DONE (do NOT rebuild):**
Privacy (`/privacy`, NO, 169 ln) · Terms (`/terms`, 183 ln) · Cookie banner (wired in `Layout`) · GDPR export+delete (`/profile/data` + services) · Help center (`/hjelp` + kjope/selge/trygg-betaling) · Receipts (`kvittering` pages) · Vipps login (OIDC) + Vipps as a Checkout method · SEO sitemap + per-item OpenGraph/Twitter share cards · Bokføring export API · ~500 tests incl. 99% money-path mutation gate + real-Postgres integration · per-category marketplace theming.

---

## 1. Pre-launch blockers (P0)

### 1.1 MVA / VAT — the real launch gate
**Why:** Receipts only *label* MVA; there's no VAT engine. Per the plan's own risk table, a VAT gap can pause launch. Needs accountant sign-off.
**Work:**
- [ ] Decide VAT model with an accountant: is the platform fee VAT-able (yes, 25% output VAT on the fee); are seller sales VAT-able (depends — private sellers no, registered `Butikker` yes).
- [ ] Add `vat_rate` / `vat_nok` to the fee calc in `listings.ts` (`completeListingPurchase`, `purchaseListing`) and `commissions.payCommission`; persist on the row.
- [ ] Show VAT line on `kvittering` receipts (real number, not label).
- [ ] Per-`Butikker` VAT: registered businesses charge VAT-inclusive prices; surface orgnr + MVA on their receipts.
- [ ] Skatteetaten/bookkeeping export includes VAT columns.
**Acceptance:** a purchase produces a receipt with a correct VAT breakdown; platform-fee output VAT is recorded; accountant signs off.
**Effort:** L (2–3 days code + accountant loop). **Blocked on:** accountant input.

### 1.2 Seller onboarding wizard + first-listing template
**Why:** New sellers hit a bare Stripe Connect wall; biggest supply-side friction.
**Work:**
- [ ] `/market/selg/start` (or `/onboarding/selger`) multi-step: (1) what you'll sell → (2) Stripe Connect onboarding with plain-language copy → (3) first-listing template prefilled (kind+category) → (4) photo guidance.
- [ ] First-listing template: prefill from common patterns; inline photo tips (lighting, flat-lay, 3+ photos).
- [ ] Entry points: `become-seller` success, empty `my-listings`, post-Vipps welcome.
- [ ] Tests: e2e walks the wizard as a new persona; service-layer unit for any new helper.
**Acceptance:** a brand-new user can go signup → seller → first active listing without dead-ends.
**Effort:** M (2 days).

### 1.3 Welcome / lifecycle emails
**Why:** No `welcome` template; first-touch retention is zero.
**Work:**
- [ ] Add Resend templates: welcome (on signup), seller-activated, first-sale.
- [ ] Trigger welcome from `auth/callback` first-login path; gate on consent.
- [ ] Unit-test the template builders (pure), assert subject/body shape.
**Acceptance:** new account gets a welcome email; templates covered by tests.
**Effort:** S (1 day).

### 1.4 Error tracking + performance monitoring
**Why:** No Sentry, no Web Vitals/RUM. Flying blind at launch.
**Work:**
- [ ] Wire Sentry (Cloudflare Workers SDK) for server + client; scrub PII; route the existing `dead_letter_events` failures as breadcrumbs.
- [ ] Web Vitals reporter (CLS/LCP/INP) → a lightweight endpoint or Sentry performance.
**Acceptance:** a thrown error and a slow page both show up in the dashboard.
**Effort:** S–M (1 day).

### 1.5 Ops / infra
**Why:** Manual `wrangler deploy`, no staging, free-tier (no backups). Risky for a real launch.
**Work:**
- [ ] GitHub → Cloudflare Workers Builds auto-deploy on `master`.
- [ ] Staging: separate Supabase project (or branch) + a `staging.*` Worker env; point `.env.staging` at it.
- [ ] Supabase Pro: enable scheduled backups + do one restore drill; document it.
- [ ] CI: run `npm test` + `npm run typecheck` + `npm run build` on PRs; optionally `test:mutation` on commerce-path changes.
**Acceptance:** push to master auto-deploys; a restore drill succeeds; CI is green-gated.
**Effort:** M (1–2 days, partly account setup).

### 1.6 Apply migration 0080 to prod (carryover)
**Why:** `0080_fix_anon_profile_policy_reads.sql` fixes the anon-browse 403 introduced by the 0077 security pass. Logged-out marketplace browsing is broken on prod until applied.
- [ ] Apply `0080` in the Supabase dashboard; then `supabase db diff --linked` should be empty.
**Effort:** XS.

---

## 2. Pre-launch, lower urgency (P1)

- [ ] **Contact/support routing** — replace `mailto:` in `/hjelp` with a form that opens a moderator thread (reuse `moderation_threads`), so support is tracked in `/inbox`.
- [ ] **Admin observability** — extend `/admin` from counts to trends: daily volume, GMV/revenue, signups, open reports/disputes, 7-day sparkline.
- [ ] **`/om` (About)** — replace the 9-line stub with real brand/story copy (byline: Weggersen Design).
- [ ] **Partial refunds + reason picker** — `refunds.ts` is full-refund only; add amount + reason enum.
- [ ] **Phone verification** — Vipps already returns a verified phone; persist + display it, decide if SMS step is needed for non-Vipps signups.

---

## 3. Polish / post-launch (P2)

Buyer retention: saved searches + alerts · weekly digest · listing variants (size/color) · wishlist (named lists).
Stores: analytics dashboard · bulk CSV import · vacation mode · custom slug change · collections.
Commission: milestone (split) escrow · photo-update nudges · yarn-order integration.
Discovery: recommendation tuning (use view/impression signal, not just favorites) · referral program · public studio profiles.
Trust: KYC escalation at volume · velocity/IP fraud signals · buyer/seller block list.
Payments: Klarna for high-value commissions.

---

## 4. Suggested sequence (June)

| Week | Focus | Items |
|------|-------|-------|
| 1 | Truth + supply | §0 doc reconcile, §1.6 apply 0080, §1.2 seller onboarding wizard |
| 2 | Trust to operate | §1.4 Sentry/Web Vitals, §1.5 CI + auto-deploy + staging |
| 3 | Money correctness | §1.1 VAT (start accountant loop early in wk1), §1.3 welcome emails |
| 4 | Soft-launch polish | §2 contact routing, admin trends, /om, partial refunds; E2E pass |

**Recommended first task:** §1.2 seller onboarding wizard (unblocks supply, fully in our control) — or kick off §1.1 VAT's accountant conversation in parallel since it's the long pole.

---

## 5. How to use this file
- Tick items here as they land; mirror the change into `BUSINESS_PLAN.md` so the canonical plan stays accurate.
- Each feature ships with tests per `CLAUDE.md` (unit for pure logic, e2e for flows, fake-db/integration for DB).
