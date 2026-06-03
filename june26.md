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

### 1.2 Payments money-flow failure-mode hardening (NEW — highest-risk subsystem)
**Why:** webhook handles only `checkout.session.completed` + `account.updated`. **No** handlers for chargebacks/refunds/payout-failures/failed-payments. Chargeback after payout = silent loss; failed payout = seller silently unpaid; day-14 auto-release `capture()` only `try/catch`-logs — failed capture means the seller is never paid with no recovery.
**Work:**
- [ ] Handle `charge.dispute.created` / `.closed` → freeze item, open dispute, notify, reconcile against payout.
- [ ] Handle `payout.failed` / `payout.paid` → notify seller, retry/flag.
- [ ] Handle `payment_intent.payment_failed` / capture failures → mark order, dead-letter, recovery job.
- [ ] Auto-release cron: on capture failure, retry with backoff + dead-letter + alert (don't silently drop).
- [ ] Refund-after-payout reconciliation (negative balance handling).
- [ ] Webhook idempotency at scale (dedupe by event id) + extend the signed-webhook integration test to cover these events.
**Acceptance:** each event type has a handler + test; a simulated chargeback and a failed payout both produce a tracked, notified outcome.
**Effort:** M–L (2–3 days).

### 1.3 Reliable migration delivery + schema-drift CI gate (NEW — proven-fragile)
**Why:** evidence of breakage — `0038` partially applied to prod; `0077` broke anon browse. Process is manual dashboard-paste (non-transactional). This *will* recur.
**Work:**
- [ ] Move migration application to **CI `supabase db push`** (transactional) against staging then prod; stop manual paste.
- [ ] CI gate: `supabase db diff --linked` must be empty (schema-drift detection) before deploy.
- [ ] CI runs `npm test` + `typecheck` + `build`; RLS test suite + money-path mutation gate against an **ephemeral Postgres**; block merge on red.
**Acceptance:** a migration reaches prod only via CI; drift check is green; PRs are gated.
**Effort:** M (1–2 days, partly account setup).

### 1.4 Incident response: payments kill-switch + rollback + flags (NEW) — ☑ DONE 2026-06-03
**Why:** no staging + manual deploy + no off-switch = a bad release has no recovery path. Confirmed: no feature flags, no kill-switch.
**Work:**
- [x] Runtime **kill-switch** env flags: disable new purchases / payouts / commissions independently → `src/lib/flags.ts` (`killGuard`/`isKilled`), read live from the Cloudflare runtime binding so a dashboard flip takes effect next request. Guards in `listings.ts` (purchase, ship-capture skip, confirm-delivery), `commissions.ts` (payCommission, confirmDelivery), `promotions.ts`, `checkout.ts`, and both `cron/run.ts` auto-release passes. New `service_unavailable`→503 code.
- [x] Minimal feature-flag mechanism (env-backed) → `isFeatureOn('name')` reads `FLAG_<NAME>`.
- [x] Rollback runbook (deploy revert, migration revert, incident checklist) → `docs/INCIDENT_RUNBOOK.md`.
- [x] Tests: `src/lib/flags.test.ts` (9 cases); full suite 507 green; build clean.
**Acceptance:** ✅ flipping a switch returns 503 + a Norwegian pause message on the next request; escrow stays held under `KILL_PAYOUTS`; documented rollback steps.
**Effort:** S–M (done in ~½ day).

### 1.5 Seller onboarding wizard + first-listing template
**Why:** sellers hit a bare Stripe Connect wall; biggest supply-side friction. Fully in our control.
**Work:** guided `/market/selg/start`: intent → Connect onboarding (plain copy) → prefilled first listing (kind+category) → photo guidance. Entry points: become-seller success, empty my-listings, post-Vipps welcome. e2e test the walk-through.
**Acceptance:** new user → seller → first active listing, no dead-ends. **Effort:** M (2 days).

### 1.6 Welcome emails + deliverability
**Why:** no `welcome` template; and email is useless in spam.
**Work:** Resend templates (welcome / seller-activated / first-sale), triggered from `auth/callback` first-login (consent-gated), unit-tested builders. **Set SPF + DKIM + DMARC** on the sending domain; verify inbox placement.
**Acceptance:** welcome email arrives in inbox (not spam); templates tested. **Effort:** S (1 day).

### 1.7 Observability: errors + perf + product analytics
**Why:** flying blind. No Sentry, no Web Vitals, no funnel analytics.
**Work:** Sentry (Workers SDK, PII-scrubbed, dead-letter breadcrumbs) · Web Vitals (LCP/CLS/INP) → Sentry perf · privacy-respecting product analytics (self-hosted Plausible/Umami — GDPR-clean) on the onboarding + checkout funnel.
**Acceptance:** a thrown error, a slow page, and a checkout drop-off all show up. **Effort:** M (1 day).

### 1.8 Apply 0080 + verify prod RLS == migrations (carryover)
- [ ] Apply `0080_fix_anon_profile_policy_reads.sql` to prod (fixes anon-browse 403 from 0077). Then `supabase db diff --linked` empty. (Folds into §1.3's drift gate going forward.)
**Effort:** XS.

---

## 2. Before public launch (P1)

### 2.1 Trust & Safety minimum (pulled forward from P2)
A public payments marketplace can't open without: chargeback/fraud handling (ties to §1.2) · seller-payout velocity/anomaly caps (extend the existing quota system) · prohibited-items policy + enforcement · **Norwegian illegal-content reporting obligation** · buyer/seller block list · a 1-page moderator T&S runbook.

### 2.2 Accessibility pass (WCAG AA)
Contrast audit on the new colored pills/cards · keyboard nav + visible focus · focus trap + ESC + restore on the photo lightbox & modals · image alt text · form labels/aria · prefers-reduced-motion for view transitions.

### 2.3 Others
Contact/support form that opens a moderator thread (reuse `moderation_threads`) instead of `mailto:` · admin observability → trends (GMV/revenue/signups/open reports, 7-day sparkline) · partial refunds + reason picker · `/om` real content (byline: Weggersen Design) · phone surfacing (Vipps already returns verified phone).

### 2.4 Image delivery (cost + perf)
Photo-heavy app serves full-size images straight from Supabase storage → egress cost + poor LCP. Route through Cloudflare Images / a transform (thumbnails on cards, full on detail). Ties to the §A LCP gate.

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
