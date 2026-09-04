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
| **Butikker** (stores) | `/market/stores` | 🟡 GATE | **OFF → M5** | store Connect onboarding now built (store-level payouts); `listUsers` cap fixed. Remaining before flip: live store-Connect payout smoke (M0) + optional Brønnøysund CI mock. Subscription/billing deferred (not launch-blocking). |

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

## M2 — Oppskrifter (pattern shop) *(code done — awaiting M0 + prod smoke)*

The simplest money path (no escrow, no shipping). Open right after M0.
- [ ] M0 complete (live keys + webhook). *(owner)*
- [x] **Behavioral fulfilment test** — a real Stripe-signed `checkout.session.completed` POSTed to the webhook → real Postgres, asserting the `purchases` upsert (`webhook-purchase.integration.test.ts`: grant, missing-metadata 400, duplicate-idempotent). Closes the "paid customers get no PDF" gap.
- [x] **`v1.pdf` existence guard** — `createPatternCheckout` now refuses to charge when the pattern's `<slug>/v1.pdf` is confirmed missing in the `patterns` bucket (fails open on a storage error so a blip can't block a sale). `patternPdfExists` + wiring unit-tested.
- [x] **Purchase-confirmation notification** — the webhook fires a `pattern_purchased` in-app notification ("Oppskriften din er klar!" → /profile/purchases). New enum value (migration 0101).
- [ ] Prod smoke: one real purchase → download. *(owner, after M0)*

**Flip:** `FLAG_SECTION_OPPSKRIFTER=on` (after M0 + the prod smoke).

---

## M3 — Brukt + Nytt (listings marketplace) *(shared escrow rail)*

Both open together (same buy→escrow→ship→deliver flow, filtered by `kind`).
- [x] **Fix**: refund-accept now honours the payouts kill-switch — `respondToRefund`'s accept path calls `killGuard(['payouts'])` before any Stripe/DB change (the decline path only escalates to a dispute, so it stays unguarded). Unit-tested (accept blocked, decline not).
- [ ] **Real-Stripe escrow smoke** (test mode) — runbook below. Never exercised against real Stripe rails today (all e2e bypass via `sk_simulate`/test-exec). *(owner, needs test keys + Stripe CLI)*
- [x] **Carrier labels (Posten/Bring) wired** — sellers can generate a real Posten label (auto-filled with the buyer's address) via `bookListingShipping`, which books the shipment, stores the label + shipment number on the order, and delegates to capture-at-ship with the real tracking number. Gated behind a configured carrier (`bringAuthFromEnv`); without keys the seller keeps the manual-tracking fallback. Helthjem slots in as a second carrier once its API is confirmed (its module is still stubbed). Unit-tested (8 cases: guards + happy path). *Needs Bring credentials in prod to verify end-to-end (owner).*
- [ ] *(watch)* hardcoded shipping-rate table (`shipping.ts`) can drift from real Posten pricing — bounded (locked per listing) but a margin/support risk.

### Escrow smoke runbook (run once with Stripe **test** keys)
Set `sk_test_…` + a test `STRIPE_WEBHOOK_SECRET` in `.dev.vars`, restart dev, and
forward events: `stripe listen --forward-to localhost:4321/api/stripe/webhook`.
Then with a real Stripe **test card** (`4242 4242 4242 4242`):
1. **Buy → auth held**: purchase a listing → Checkout completes → webhook reserves
   the listing + creates the `orders` row with the PI (manual capture, uncaptured).
2. **Ship → capture-at-ship**: seller marks shipped → `paymentIntents.capture`
   succeeds; funds move to the platform, destination transfer pending.
3. **Confirm → release**: buyer confirms delivery → escrow releases to the seller's
   connected account; `payment_events` shows `captured` then `released`.
4. **Refund path**: on a second purchase, buyer requests refund → seller accepts →
   assert `refunds.create({reverse_transfer:true, refund_application_fee:true})`
   unwinds buyer + seller + platform to zero.
Confirm in the Stripe test dashboard that each PI/transfer/refund matches the
`payment_events` ledger. Any mismatch is a blocker.

**Flip:** `FLAG_SECTION_BRUKT=on`, `FLAG_SECTION_NYTT=on` (after M0 + this smoke + the Bring decision).

---

## M4 — Oppdrag (commissions) *(code done)*

Money engine is production-grade (H2b escrow, rail-aware refund/release, idempotency, double-transfer guard, no stubs) — the gap was operational coverage, now closed.
- [x] **Commission e2e scenarios** with `payment_events` ledger assertions: `commission-dispute` (dispute_opened + dispute_resolved + released), `commission-cancel-late` (refunded), `commission-auto-release` (released). Building these caught a **real bug**: the cron auto-release moved the money + marked delivered but never recorded the `released` ledger event — now fixed.
- [x] **Reconciliation sweep** — `reconcileStuckCommissionPayments` (new cron section `reconcile_commissions`): finds `awaiting_payment` requests with a stored checkout session that are stale (>30 min), re-checks Stripe, and finalizes the ones Stripe says are `paid` (self-heals a lost webhook), leaving abandoned checkouts alone. `payCommission` now stores `stripe_checkout_session_id` (migration 0103). Unit-tested (selection + paid/unpaid branching).
- [x] *(already covered)* `FLAG_SECTION_OPPDRAG` gives the full-surface rollback (`KILL_COMMISSIONS` only blocks payment).

**Flip:** `FLAG_SECTION_OPPDRAG=on` (after M0 + M3's real-Stripe smoke, since it shares the rail).

---

## M5 — Butikker (stores)

The membership/roles/invitations/storefront/conversion machinery is complete and RLS-hardened.
- [x] **Scope decision (owner): store-level payouts.** A store is its own seller of record — the registered company receives the revenue on its **own** Stripe Connect account, not a member's personal one.
- [x] **Built store Connect onboarding.** The escrow payout path already routed store-owned listings to `stores.stripe_account_id` (refusing the sale if the store wasn't onboarded), but *nothing populated it* — so store listings could never actually sell. Added:
  - `startStoreOnboarding` (`store-connect.ts`) — owner-only; creates the store's **Express** Connect account (NO company, orgnr as `tax_id`, prefilled from Brønnøysund), persists `stripe_account_id`, and returns a Stripe-hosted onboarding Account Link. Reuses an existing account rather than minting a second. 6 unit tests.
  - `POST /api/stores/:slug/connect` — owner-gated endpoint that redirects to the hosted link.
  - `account.updated` webhook now also syncs stores (by `stripe_account_id`): sets `stripe_connect_status` + `stripe_connect_requirements`, flips `stripe_onboarded` on `verified`, and notifies the owner once. Migration `0104` adds those two columns.
  - Store admin **Utbetalinger** card: "Sett opp utbetalinger med Stripe" / "Fortsett Stripe-oppsett" / "Klar", owner-only.
  - *Deferred (not launch-blocking):* store subscription/billing.
- [x] **Fixed the `listUsers` cap** — extracted a paginated `findAuthUserByEmail` (scans all pages, not just the first 1000) and used it in `inviteMember`. The old single `perPage:1000` call silently missed anyone past position 1000 (broke the already-member check + in-app invite). Unit-tested incl. a match at position 1235. `vips-session.ts` has the same inline pattern it can adopt later.
- [x] **Confirmed `store_invitations` RLS is secure** — SELECT/INSERT are admin-gated (INSERT carries a `WITH CHECK` pinning the store role); there is **no UPDATE/DELETE policy**, so accept/decline/revoke are service-role-only. A direct PostgREST caller can't forge, accept, or revoke an invite. No fix needed.
- [ ] **Brønnøysund resilience / CI** — the orgnr lookup is a synchronous hard dependency on `data.brreg.no` with no caching/retry; an outage blocks store creation, and its e2e (`stores.spec.ts`) is CI-excluded (external dep) so the create/lookup path has no CI gate. Add a mocked-lookup CI variant (+ optional retry/cache). *(remaining code item)*
- [ ] **Live store-Connect payout smoke (M0, owner):** onboard a real store to Stripe Connect (live), sell a store-owned listing, confirm the payout lands on the **store's** account (not a member's). Gates the flag flip.

**Flip:** `FLAG_SECTION_BUTIKKER=on` — after the live store-Connect smoke passes.

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
