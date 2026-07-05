# Stripe go-live runbook

Takes the marketplace from Stripe **test** to **live** payments. The code needs
**no change** — every Stripe call reads `env.STRIPE_SECRET_KEY` server-side, so
go-live is entirely a matter of setting the right secrets in the right place.

> **Three modes** the code understands (all keyed off `STRIPE_SECRET_KEY`):
> | Mode | Key | Where |
> |------|-----|-------|
> | Simulate | `sk_simulate` | local default + CI (offline in-memory double, no network) |
> | Test | `sk_test_…` | local, for real Checkout with test cards |
> | Live | `sk_live_…` | production only |
>
> **Guards** (`src/lib/stripe.ts`): the dev server refuses a `sk_live_` key;
> a production build refuses `sk_simulate`. So you can't accidentally charge
> real cards locally, or silently fake payments in prod.

Checkout is **redirect-based** (`checkout.sessions.create` → hosted Stripe
page), so there is **no publishable key in the browser** — nothing client-side
to configure. Only two server secrets matter: `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET`.

---

## Part A — Local: real Stripe test mode (optional, alongside simulate)

The default local key is `sk_simulate` (instant, offline). To click through the
**real** Stripe Checkout with test cards:

1. Get your **test** keys from the Stripe dashboard (toggle to *Test mode*) →
   Developers → API keys → copy the **Secret key** (`sk_test_…`).
2. In `.dev.vars`, swap the Stripe line:
   ```
   STRIPE_SECRET_KEY="sk_test_…"
   ```
3. Forward webhooks to localhost with the Stripe CLI (test events don't reach a
   localhost URL otherwise):
   ```
   stripe login
   stripe listen --forward-to localhost:4321/api/stripe/webhook
   ```
   It prints a `whsec_…` signing secret — put it in `.dev.vars`:
   ```
   STRIPE_WEBHOOK_SECRET="whsec_…"
   ```
4. Restart the dev server (`npm run dev:fresh`). Use test card **4242 4242 4242
   4242**, any future expiry, any CVC. Watch the `stripe listen` terminal for
   events.

To go back to the offline double, restore `STRIPE_SECRET_KEY="sk_simulate"` and
restart. (Automated tests + `seed-world` always use the double regardless.)

---

## Part B — Production go-live (owner-only steps)

These happen in the **Stripe** and **Cloudflare** dashboards — they can't be
done from the codebase.

### B1. Activate the Stripe account for live payments
Stripe dashboard → **Activate account**: complete the business profile, bank
account for payouts, and — because this is a **Connect** platform — the
**Connect platform profile** (how you onboard sellers, who's liable, branding).
Until this is done, `sk_live_` keys reject charges.

### B2. Register the live webhook endpoint
Toggle the dashboard to **Live mode**, then Developers → **Webhooks** → Add
endpoint:
- **URL:** `https://strikketorget.no/api/stripe/webhook`
- **API version:** `2026-04-22.dahlia` (must match `src/lib/stripe.ts`)
- **Events to send** (exactly what the handler processes):
  - `checkout.session.completed`
  - `account.updated`
  - `charge.dispute.created`
  - `charge.dispute.closed`
  - `charge.refunded`
  - `payout.failed`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`

Copy the endpoint's **Signing secret** (`whsec_…`) — this is the live
`STRIPE_WEBHOOK_SECRET`.

### B3. Set the two live secrets on the Cloudflare Worker
These are runtime secrets (not baked into the bundle, not in git/CI). Set them
with wrangler (you'll be prompted to paste each value — it never touches the
shell history):
```
npx wrangler secret put STRIPE_SECRET_KEY      # paste sk_live_…
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # paste whsec_… from B2
```
(Or Cloudflare dashboard → Workers → the worker → Settings → Variables →
Secrets.) No redeploy needed for secret changes to take effect on the next
request, but a deploy is harmless.

### B4. Live smoke test
1. As a real seller account, complete Connect onboarding (real KYC in live mode).
2. List an item, buy it with a **real card** for a small amount.
3. Verify: the order flips to `reserved`, the `payment_events` ledger has the
   row, the Stripe dashboard (Live) shows the PaymentIntent + application fee,
   and the webhook shows `200`.
4. Ship → confirm delivery → verify the transfer to the seller and the payout
   schedule in the Connect dashboard.
5. Refund that test purchase from the dashboard to confirm `charge.refunded`
   flows back through the webhook.

### B5. Verify the guards are satisfied
- Prod must **not** run `sk_simulate` (the app throws on payment if it does).
- Confirm `/api/stripe/webhook` returns `400` (not `500`) for an unsigned POST —
  that proves signature verification is active with the live secret.

---

## Rollback
Payments are gated by the key. To pause live payments, either flip the
`STRIPE_SECRET_KEY` secret back to a test key, or use the existing kill-switch
(`killGuard(['purchases'])`) via feature flags to stop new purchases while
leaving the rest of the site up. Disputes/refunds continue to flow through the
webhook regardless.

## Account ownership + business-structure notes (decided 2026-07)

The platform Stripe account must belong to the **registered operating entity**,
not a personal account — the platform is merchant of record (funds flow buyer →
platform → seller), so payment volume, chargeback/refund liability, and tax all
sit with the account holder.

- **Owner:** Strikketorget is registered to (wife). Create/activate the Stripe
  account under **her / the business**, add the developer as a **team member**
  (Developer role) for integration work. Do NOT use a personal Stripe account.
- **Structure today: ENK** (enkeltpersonforetak). Valid for Stripe, but ENK =
  **unlimited personal liability** — chargebacks, buyer refunds, and a negative
  Stripe balance land on the owner personally. The escrow design (manual
  capture, 7-day payout delay, delivery confirmation) caps realistic downside,
  and low-value physical goods are defensible on disputes, so ENK is an
  acceptable *launch* structure.
- **AS-conversion trigger:** convert to an AS (limited liability, ~30k NOK share
  capital) once monthly GMV — other people's money moving through the platform —
  is large enough that personal exposure is uncomfortable. Nothing in the code
  changes; only the Stripe account's entity does.
- **Ask a regnskapsfører before scaling:** (1) as merchant-of-record collecting
  the *gross* amount, what counts as the ENK's MVA turnover — the commission
  (revenue) vs. the seller's share (pass-through)? (2) MVA registration is
  mandatory past 50 000 NOK turnover / 12 months. (3) confirm the liability
  picture for a payments platform specifically.

## Seller remediation (gap to build before real sellers)

Custom Connect makes the platform responsible for (a) telling sellers when their
account needs more info / is restricted and (b) collecting that info. Today the
`account.updated` webhook stores `requirements` but only notifies on the
happy-path "verified" transition, and `become-seller` can't re-submit info for
an existing account. Build: a "verification needed" seller notification when
requirements appear, and a remediation path (a Stripe Account Link the seller
clicks to submit what's due). Independent of which account owns the platform.

## Money-path safety (already in place)
- Webhook verifies the Stripe signature (`constructEventAsync`) and is
  **idempotent** (`markEventProcessed` per `event.id`).
- Failures land in `dead_letter_events` for audit (surfaced on `/admin`).
- Escrow (manual capture), Connect transfers, refunds, payouts, and
  dispute/chargeback handling are covered by the mutation-tested money
  functions (`npm run test:mutation`).
