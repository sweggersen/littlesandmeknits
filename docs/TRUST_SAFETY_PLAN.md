# Trust & Safety plan — commissions + fraud

Consolidates the design decisions from the go-live discussion (2026-07). Scope:
make commissions ("Strikk for meg") and item sales safe enough to launch,
without over-engineering for edge cases. **Nothing here blocks the code today;
it's the pre-/early-launch backlog.**

## Guiding principle
Risk is **concentrated in new/unproven users** (no reviews). Gate the risky
capabilities behind reputation rather than trying to insure every edge case.
And: the platform is **merchant of record** (see STRIPE_GO_LIVE.md) — as an ENK
today, losses land on the owner personally, so *reduce and deter*, don't promise
to *cover* uninsurable things (physical yarn, transit damage).

---

## What's already protected (foundation — don't rebuild)
- **Commission money is escrowed.** Buyer pays → funds sit in the platform
  balance → released to the knitter only on **buyer delivery-confirm** or
  **+14-day auto-release**. A non-delivering/scamming knitter is **never paid**,
  and the buyer is **refundable** (`refundCommissionPayment`). So "knitter takes
  money and vanishes" is already a non-event for the buyer's cash.
- **Item sales escrow**: manual capture, captured on ship, buyer confirm or
  14-day auto-release, dispute/refund path.
- **Seller auto-protection**: a silent buyer can't hold funds hostage —
  14-day auto-release pays the seller.
- **Knitters/sellers aren't anonymous**: Stripe Connect KYC ties a real name,
  DOB, address, and bank account to every payout account — a real deterrent and
  a handle for reporting/clawback.
- **Chargeback + dispute handling** wired (webhook: `charge.dispute.*`,
  `charge.refunded`; in-app `/admin/disputes`).
- **Request expiry**: open requests with no offers auto-cancel after 30 days.
- Terms already cover much of this (`/terms` §4–§7).

---

## Decisions taken
1. **Commission fee → 8%** (from 12%). *(Staged, not yet implemented — build P0.1.)*
2. **Commission fee is paid by the BUYER on top**, not deducted from the
   knitter. The knitter keeps **100%** of their quote; the offer/checkout shows
   the buyer *"offer price + Strikketorget fee"*. Mirrors the item-sales model
   (buyer pays the trygg-betaling fee, seller keeps 100%). More attractive to
   knitters. *(Build P0.1.)*
3. **Physical yarn liability = the buyer's.** The platform reimburses **money**
   (escrow), never **physical yarn**. Reimbursing goods is unbounded and
   collusion-gameable. Mitigate via reputation-gating, not insurance.
4. **"Trygg betaling" naming is OK for commissions**, but scoped honestly: it
   protects the **payment** (held, refundable if undelivered) — **not** the yarn
   or the exact timeline. Copy must say this.
5. **No milestone-based escrow** (pay 50% at halfway). Money release stays
   binary (on delivery). Milestones multiply disputes + platform liability.

---

## Build backlog (prioritized)

### P0 — before real commissions/sellers go live
- **P0.1 — Fee model: 8% + buyer-pays-on-top.** Change `COMMISSION_FEE_PERCENT`
  to 8; buyer amount = price + fee; transfer = full price to knitter; update the
  offer/checkout **display** (buyer sees price + fee breakdown); update copy
  (`/terms` §5, become-seller) so the knitter keeps 100%; update the money tests
  (`commissions-money.test.ts`, `commissions.test.ts`, `disputes.test.ts`) +
  the seed helper. Re-run `npm run test:mutation`.
- **P0.2 — Required tracked shipping.** Today the tracking code is optional
  ("Sporingskode (valgfritt)") at both listing-ship and commission-complete.
  Make it **required** (or the strong default), wired to Bring/Posten
  (`bring.ts` exists). This is the single highest-value fraud control: it
  defeats "didn't receive it" and is the evidence that **wins** those Stripe
  chargebacks.
- **P0.3 — Yarn gating + policy.** Only allow **buyer-provided yarn** for
  knitters above a reputation threshold (N completed / min rating); new knitters
  → platform/knitter-sourced yarn or materials in the price. State "yarn is sent
  at the buyer's risk" at the yarn-ship step + in terms.
- **P0.4 — Seller remediation + verification notification** (from the Stripe
  walkthrough / Custom Connect obligation): notify a seller when
  `account.updated` shows new `requirements`, and give them a remediation path
  (a Stripe Account Link to submit what's due). Today the webhook only notifies
  on the happy-path "verified" transition. See STRIPE_GO_LIVE.md.

### P1 — soon after launch
- **P1.1 — Commission deadline enforcement.** `needed_by` is stored but not
  enforced. If the knitter hasn't marked completed by X days past the deadline,
  offer the buyer **"your knitter is late — cancel for a full refund"** (+
  notify). Handles late / disappeared / dead-knitter cleanly, money-side.
- **P1.2 — Server-stamped condition photos at ship.** Seller/knitter uploads
  photos (both sides) **through the platform** at the ship step; the **server**
  records the timestamp (EXIF is forgeable — don't trust it). Evidence for
  "damaged/not as described" disputes. Require for commissions + higher-value
  sales; optional for cheap items. Frame as "protect yourself against false
  claims."
- **P1.3 — Buyer dispute-history tracking.** Track a per-buyer refund/dispute
  rate (symmetric to seller trust). Flag/scrutinize repeat "damaged/not
  received" claimers; factor into dispute decisions.

### P2 — nice to have / as volume grows
- **P2.1 — Light progress photo** partway through a commission (via project
  updates the buyer sees). Trust signal + dispute evidence. **Not** tied to
  money release.
- **P2.2 — New-knitter commission price cap** to bound exposure until they build
  a track record.

---

## Explicit non-goals (do NOT build)
- Reimbursing physical yarn or transit-damaged goods (unbounded, gameable).
- Milestone/partial escrow release for commissions.
- Heavy verification/proof for low-value item sales (scale controls to value).
- Trying to *eliminate* friendly fraud / SNAD chargebacks — impossible. Reduce,
  deter, and absorb a small residual (another reason to convert ENK → AS as GMV
  grows).

## Honest limits to keep in mind
- **Card-network chargebacks decide themselves.** For "not received," tracking
  usually wins; for "not as described" (SNAD), networks favor the buyer and
  photos help but don't guarantee a win. As merchant of record you absorb the
  residual.
