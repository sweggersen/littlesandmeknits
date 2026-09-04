# Go-live milestones & feature-flag gating

**Created:** 2026-09-04 · derived from a full-functionality readiness audit (5 parallel deep audits: listings, commissions, stores, profil+strikkestua, pattern-shop+cross-cutting).

**Launch posture (chosen):** *Soft launch* — ship the proven sections ON, gate the money-heavy / less-proven ones behind feature flags, and open each only after it passes its milestone session.

---

## How gating works

Each section is gated by a runtime feature flag read from the Cloudflare env (flip **without a redeploy**, same mechanism as the `KILL_*` switches):

| Layer | Flag | Effect when OFF |
|-------|------|-----------------|
| Section | `FLAG_SECTION_<NAME>` | nav pill hidden + route redirects to a "kommer snart" page |
| Money kill-switch | `KILL_PURCHASES` / `KILL_PAYOUTS` / `KILL_COMMISSIONS` | blocks the money step only (break-glass) |

**Default is ON** (a section shows unless its flag is explicitly `off`), so a missing flag never blanks the site — we gate *deliberately*. Helper: `src/lib/sections.ts` `sectionEnabled(section, env)`.

Section names: `brukt`, `nytt`, `oppdrag`, `butikker`, `profil`, `strikkestua`, `oppskrifter`.

---

## Readiness snapshot

| Section | Route | Verdict | Launch flag | Key blocker(s) |
|---------|-------|---------|-------------|----------------|
| **Profil** | `/profile` | ✅ SHIP-READY (M1 done) | ON | — |
| **Strikkestua** | `/studio` | ✅ SHIP-READY (M1 done) | ON | no money surface |
| **Oppskrifter** (pattern shop) | `/oppskrifter` | 🟡 GATE | **OFF → M2** | live-Stripe cutover; no fulfilment test; `v1.pdf` existence unchecked |
| **Brukt** (pre-loved) | `/market/used` | 🟡 GATE | **OFF → M3** | Bring tracking stubbed (manual code = fraud surface); no real-Stripe escrow smoke |
| **Nytt** (ready-made) | `/market/new` | 🟡 GATE | **OFF → M3** | same rail as Brukt (shared escrow flow) |
| **Oppdrag** (commissions) | `/market/commissions` | 🟡 GATE | **OFF → M4** | no e2e for dispute/refund/cancel-late/auto-release + ledger; paid-but-unfinalized needs a reconciliation sweep |
| **Butikker** (stores) | `/market/stores` | 🟡 GATE | **OFF → M5** | store payouts route to the *personal* Stripe account, not the store; subscription/billing stubbed; `listUsers` 1000 cap |

---

## M0 — Go-live foundation (blocks EVERY money section)

None of the money sections can open until this is done. Non-money sections (Profil, Strikkestua) are independent of M0.

- [ ] **Stripe live cutover** — set `sk_live_…` `STRIPE_SECRET_KEY` + live `STRIPE_WEBHOOK_SECRET` as Cloudflare prod secrets; register the live webhook endpoint for API version `2026-04-22.dahlia`. *(Until done, `createStripe()` throws in prod on the sim key — fail-loud by design.)* Owner-only.
- [ ] **Verify prod secrets present**: `RESEND_API_KEY`, `PUBLIC_VAPID_KEY` + `VAPID_PRIVATE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — notifications / welcome email / webhook admin alerts silently no-op without them.
- [ ] **Confirm Vipps prod credentials** (`VIPPS_ENV=prod`, client id/secret/subscription key/MSN) — login blocker for all authed sections.
- [ ] **Verify `KILL_*` switches are settable + effective** in the Cloudflare prod runtime (break-glass; `docs/INCIDENT_RUNBOOK.md`).
- [ ] **One real Stripe fulfilment smoke** in test mode: at minimum a pattern purchase → `purchases` row → PDF download. (Current webhook test is static-analysis only — no behavioral coverage of `checkout.session.completed`.)

---

## M1 — Profil + Strikkestua ✅ DONE *(SHIP-READY — flag ON at launch)*

- [x] Full dashboard engine (drag/resize/add-remove/grid↔masonry, server + localStorage persistence) — covered by `profile-dashboard.spec.ts` / `studio-dashboard.spec.ts`.
- [x] `dashboard_layouts` RLS (0099) owner-pinned; `seller_profiles` self-attestation hole closed (0097).
- [x] **Touch drag support** — the drag editor was rewritten from the HTML5 drag API (never fired on touch) to Pointer Events, so reorder now works on mouse, touch, and pen. Grip is the drag handle (`touch-action:none`); e2e covers the reorder in a touch-enabled context.
- [x] **`profile/original.astro` redirected** to `/profile` (301) and the orphaned `DashboardGrid.astro` removed — no more stale second dashboard.
- [x] **`account.updated` webhook** verified-transition logic is code-complete (`webhook.ts` → `statusFromAccount`, notifies on the transition into verified, dead-letters on failure) and unit-tested (`stripe-connect.test.ts`). *Prod endpoint registration is tracked under M0.*

**Remaining before launch:** none in code. The only open item is the M0 ops step (register the live `account.updated` webhook endpoint) — shared with every money section.

---

## M2 — Oppskrifter (pattern shop) *(first money feature to open)*

The simplest money path (no escrow, no shipping). Open right after M0.
- [ ] M0 complete (live keys + webhook).
- [ ] **Behavioral fulfilment test** — integration/e2e that dispatches a signed `checkout.session.completed` and asserts the `purchases` upsert + download URL. *(Highest-value gap: today a fulfilment regression means paid customers get no PDF.)*
- [ ] **`v1.pdf` existence check** — verify the object exists in the `patterns` bucket at purchase time (or at publish), so a mispriced/misnamed upload can't yield a completed purchase whose download 500s.
- [ ] *(nice-to-have)* fire a pattern-purchase confirmation notification from the webhook (listings already do; patterns rely on the Stripe receipt + `/profile/purchases`).
- [ ] Prod smoke: one real purchase → download.

**Flip:** `FLAG_SECTION_OPPSKRIFTER=on`.

---

## M3 — Brukt + Nytt (listings marketplace) *(shared escrow rail)*

Both open together (same buy→escrow→ship→deliver flow, filtered by `kind`).
- [ ] M0 complete.
- [ ] **Real-Stripe escrow smoke** (test mode): buy → ship-capture → confirm-release, and buy → refund (reverse_transfer + refund_application_fee). Never exercised against real Stripe rails today — all e2e bypass via `sk_simulate`/test-exec.
- [ ] **Bring decision** — either wire `bookShipment`/`getTracking` into `listings-escrow.ts` (currently stubbed; sellers type a free-text tracking code) **or** explicitly accept the manual-tracking fraud risk and soften the "defeats false not-received claim" assumption in copy/policy.
- [ ] **Fix**: add `killGuard(['payouts'])` to the refund-accept path in `refunds.ts` (`respondToRefund` issues `reverse_transfer` without checking the payouts kill-switch).
- [ ] *(watch)* hardcoded shipping-rate table (`shipping.ts`) can drift from real Posten pricing — bounded (locked per listing) but a margin/support risk.

**Flip:** `FLAG_SECTION_BRUKT=on`, `FLAG_SECTION_NYTT=on`.

---

## M4 — Oppdrag (commissions)

Money engine is production-grade (H2b escrow, rail-aware refund/release, idempotency, double-transfer guard, no stubs) — the gap is operational coverage.
- [ ] M3 complete (shares the escrow/dispute infra).
- [ ] **Commission e2e scenarios** with `payment_events` ledger assertions for: dispute→resolve, cancel-late→refund, auto-release cron. Listings have all three; commissions are unit-tested only.
- [ ] **Reconciliation sweep** — a cron pass for paid-but-unfinalized commissions (automatic capture takes the money before the DB reflects it; a lost webhook leaves the buyer charged and the request stuck in `awaiting_payment`). Today recovery is dead-letter + manual support.
- [ ] *(already covered by the section flag)* the `KILL_COMMISSIONS` switch only blocks payment, not the browse/offer UI — `FLAG_SECTION_OPPDRAG` gives the full-surface rollback.

**Flip:** `FLAG_SECTION_OPPDRAG=on`.

---

## M5 — Butikker (stores)

The membership/roles/invitations/storefront/conversion machinery is complete and RLS-hardened. The **defining "business store" money layer is stubbed** — this is the largest remaining decision.
- [ ] **Scope decision (owner):** are stores *store-level payouts* (registered company receives revenue) or *branding-only over personal payouts* at launch?
  - Today: a sold store listing pays the **personal** member's Connect account (`createListing` keeps `seller_id = ctx.user.id`); store Connect columns are never read/written. `can.withdrawFunds` / `editStripeSettings` predicates exist but have no callers.
  - Branding-only → can open sooner with clear copy; store-level payouts → a real build (store Connect onboarding + payout routing + optional subscription/billing).
- [ ] **Fix `listUsers({ perPage: 1000 })` cap** in `store-invitations.ts` — silently misses users past 1000 accounts (breaks already-member check + in-app invite). Move to `admin.auth.getUserByEmail` when available, or paginate fully.
- [ ] **Brønnøysund resilience** — the orgnr lookup is a synchronous hard dependency on `data.brreg.no` with no caching/retry; an outage blocks store creation. Its e2e (`stores.spec.ts`) is CI-excluded (external dep), so the create/lookup path has no CI gate — add a mocked-lookup CI variant.
- [ ] Confirm `store_invitations` RLS posture (0097 hardened `store_members` but not invitations).

**Flip:** `FLAG_SECTION_BUTIKKER=on`.

---

## Session plan (order of execution)

1. **M0** — go-live foundation (owner + one smoke). *Unblocks all money.*
2. **M1** — Profil + Strikkestua verified ON (mostly done; prod check + small polish).
3. **M2** — Oppskrifter: fulfilment test + `v1.pdf` guard → flip ON.
4. **M3** — Brukt + Nytt: Stripe escrow smoke + Bring decision + refund kill-guard fix → flip ON.
5. **M4** — Oppdrag: commission e2e + reconciliation sweep → flip ON.
6. **M5** — Butikker: payout-scope decision (+ build if store-level) + invite cap fix → flip ON.

Each numbered item is one working session: execute its checklist, prove it, then flip the flag.

---

## Notes

- **Section flags are additive to kill-switches.** A section can be ON but its money step still halted via `KILL_*` (break-glass). Both are runtime, no redeploy.
- **`isFeatureOn`/`FLAG_<NAME>` was plumbed but unused before this plan** — `src/lib/sections.ts` is its first consumer.
- Full audit detail (per-section inventory, money surface, test coverage, risks) lives in the session that produced this doc; the checkboxes above are the actionable residue.
