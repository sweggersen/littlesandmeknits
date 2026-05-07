# 02 — Payments, escrow & VAT

## TL;DR

- Use **Stripe Connect Express** as the seller-side payment rail.
  Norway is fully supported.
- Don't add Vipps in v1. Add it in v2 once Stripe Connect's payment
  method (`vipps`) is enabled on the platform — you keep one ledger.
- "Escrow" is implemented with **separate charges + transfers** (not
  destination charges), so the platform holds the funds until the
  buyer confirms receipt, then transfers to the knitter.
- Tax: operate as a **marketplace facilitator** (knitter is the seller
  of record; we collect a service fee). Document this in ToS clearly.

## Why Stripe Connect Express

Existing app already uses Stripe for the pattern shop
(`src/lib/stripe.ts`, `src/pages/api/stripe/webhook.ts`,
`src/pages/api/checkout.ts`), so we keep one provider and one webhook
ingress.

**Connect Express** lets each knitter onboard via a Stripe-hosted flow
(ID, address, bank). We get back a `acct_xxx` that we store in
`knitter_profiles.stripe_account_id`. Stripe handles KYC / AML.

Trade-offs:
- Express keeps Stripe-branded onboarding (faster, less liability).
- Standard would let knitters use existing Stripe accounts, but those
  rarely exist for hobbyist knitters in Norway.
- Custom is more work than worth — only choose if we want to control
  the entire onboarding UI, which we don't.

## Charge model: separate charges + transfers

Three Stripe charge models, picking the right one matters:

| Model | Funds land on | Refunds | Escrow possible? |
| --- | --- | --- | --- |
| Direct charges (on connected account) | Knitter | Knitter | No (we don't hold funds) |
| Destination charges (on platform, auto-transfer) | Platform → knitter | Platform | Partial (need on_behalf_of + transfer_data flags) |
| **Separate charges + transfers** | Platform | Platform | Yes — natural fit |

Pick **separate charges + transfers**:
1. Buyer's `PaymentIntent` is created on the **platform** account with
   `application_fee_amount = 0` (we'll take fee in step 3 instead).
2. Platform receives funds. We mark `marketplace_orders.status = 'paid'`.
3. When `status` transitions to `released` (buyer confirmed delivery,
   or auto-release timer fires) we create a **Transfer** to the
   knitter's connected account for `gross_nok − platform_fee_nok −
   stripe_fee`.
4. We keep `platform_fee_nok` on the platform account (revenue).
5. Refunds: `Refund` against the original PI on the platform account.
   No transfer means the knitter wasn't paid. Easy.

This is the model Stripe explicitly recommends for marketplaces with
"hold-and-release" semantics — exactly what we need.

## Auto-release timer

Buyer doesn't always click "Bekreft mottatt." Default lifecycle:

- `shipped` → 7 days after `delivered` (or 14 days after `shipped` if
  no delivery confirmation from carrier) → auto-`released`.
- Buyer can dispute any time before auto-release. Disputes pause the
  timer.

Implementation: a Cron worker (or `pg_cron` via Supabase) that scans
for `delivered` orders past the threshold and triggers the transfer
via the existing webhook code.

## Vipps (deferred)

Vipps is the dominant Norwegian wallet — adding it would lift
conversion ~10–20pp on mobile in NO. Two paths:

1. **Stripe-managed Vipps.** Stripe added Vipps as a payment method
   (under `vipps` in `payment_method_types`). Only available in
   limited regions, check current docs at integration time. Cleanest
   because it stays in our existing rails.
2. **Direct Vipps eCom integration.** Run two ledgers (Vipps + Stripe).
   Lots of reconciliation pain. Don't.

Defer to Phase 2 — pre-loved volume in NOK 200–400 range will work
fine on cards.

## Fee structure (concrete)

All fees are taken from the seller's side; buyer sees a clean price.
No hidden buyer fees. Examples assume a 350 NOK pre-loved cardigan:

| Tier | Platform fee | Stripe processing | Seller nets |
| --- | --- | --- | --- |
| Pre-loved < 200 NOK | flat 10 NOK | ~1.4% + 1.80 NOK | gross − 10 − ~4 NOK |
| Pre-loved 200–500 NOK | 5% min 15 NOK | 1.4% + 1.80 NOK | 350 − 17.50 − 6.70 = ~325 NOK |
| Pre-loved > 500 NOK | 7% | 1.4% + 1.80 NOK | |
| Ready-made | 9% | 1.4% + 1.80 NOK | |
| Commission | 13% | 1.4% + 1.80 NOK | |

Stripe rates above are Norwegian domestic-card defaults; tune at
launch.

## Holding period & cashflow

Because we use separate charges + transfers, funds sit on the platform
balance from `paid` to `released` — typically 7–14 days.

- This creates working capital we *don't* want to spend (it isn't
  ours; it's the knitters').
- Treat platform balance as a **trust balance** in accounting. Do not
  draw down for opex.
- Stripe will payout the platform fee portion to our bank account on
  the normal payout schedule once the transfer to the knitter clears
  the application fee logic.

## VAT (MVA) — the hard part

Norwegian VAT (MVA) is 25% standard, 15% on food, 12% reduced. Knitwear
is 25%. Three statuses to handle:

### A. Knitter is a hobbyist (hobbyselger)
- < 50 000 NOK turnover/year, casual sales, not a business
- No MVA. Income is reported on `selvangivelse` as misc income.
- Most pre-loved sellers will be here. Most ready-made sellers too.

### B. Knitter is a sole proprietor (enkeltpersonforetak), MVA-registered
- Crossed 50 000 NOK threshold or chose to register voluntarily
- Must charge MVA on sales; we display gross-incl-MVA to buyer
- We pass MVA breakdown back to the knitter via order receipt
- Knitter remits MVA to Skatteetaten themselves

### C. Knitter is a sole proprietor, NOT MVA-registered (under threshold)
- Sells under their `org_number` but doesn't charge MVA
- Income is business income, taxed in `næringsoppgave`, not MVA-relevant

### Platform's role: marketplace facilitator
- We are NOT the seller. The knitter is.
- We charge the buyer on their behalf (payment intermediation).
- We charge the knitter a service fee — that fee IS our revenue, and
  it IS MVA-applicable on us once *we* cross 50 000 NOK.

### What we collect at onboarding
- `mva_registered` (bool, self-declared)
- `org_number` (optional, free text)
- Onboarding copy: "Du er ansvarlig for å oppgi inntekten korrekt. Vi
  rapporterer ikke for deg." Link to Skatteetaten guidance.

### What goes on the buyer receipt
- Item price (gross)
- Shipping
- Total paid
- Seller name + (if applicable) org number + MVA status
- Platform service fee — itemized for the seller's records, NOT
  charged to buyer.

## Refunds & disputes

- **Buyer-initiated dispute** before `released`:
  Order goes to `disputed`. Both parties can post messages. Sam
  (admin) intervenes within 48h. Resolution: full refund, partial
  refund, or release.
- **Stripe chargeback** (buyer goes to bank): handled by existing
  webhook handler (`charge.dispute.created`). Auto-pauses transfer if
  pre-release; if post-release, pursued out-of-band.
- **Seller-initiated cancellation** before shipping: full refund, no
  fee charged. Ship the cancellation flow on day one.

## Implementation surface (rough)

New files / changes (don't build yet, just planning surface area):
- `src/lib/stripe-connect.ts` — Express account creation, refresh links
- `src/pages/api/stripe/connect/onboard.ts` — initiate onboarding
- `src/pages/api/stripe/connect/refresh.ts` — handle return URL
- `src/pages/api/orders/create.ts` — create PaymentIntent on platform
- `src/pages/api/orders/[id]/release.ts` — manual buyer release
- `src/pages/api/orders/[id]/dispute.ts` — open dispute
- `src/pages/api/stripe/webhook.ts` — extend with:
  - `account.updated` (Connect account status changes)
  - `payment_intent.succeeded` for marketplace orders (today only handles pattern PDFs)
  - `charge.dispute.created` / `charge.dispute.closed`
  - `transfer.created` / `transfer.failed`
- Cron worker: auto-release timer (Cloudflare Workers cron triggers
  in `wrangler.jsonc`, or `pg_cron` via Supabase)

## What we need from Stripe at integration time

- Enable Connect on the platform account (one-time, dashboard click).
- Decide presentation: `application_fee_amount` on PI vs separate
  Transfer object. Doc recommends Transfer for marketplaces with
  hold-and-release.
- Norwegian KYC requirements for Express are lighter than for
  Custom — Stripe handles them.
