# Vipps integration plan

Vipps is the de-facto payment method in Norway. This doc captures what's
needed to add Vipps as a payment option alongside Stripe Connect on
Strikketorget.

## Status

**Not implemented yet.** Merchant onboarding (you, not me) hasn't started.
See checklist below.

## What you need to do — onboarding

1. **Become a Vipps Merchant**.
   - Apply at <https://portal.vipps.no/register/recurring/signup>.
   - Required: orgnr (Weggersen Design, 935 918 146 ✓), bankkontonummer,
     daglig leder ID-verification, expected volume.
   - Tier: "Vipps Login + eCommerce". Vipps Recurring is *not* needed
     unless we sell subscriptions through Vipps later.
2. **Verify the business** with BankID. ~2–5 working days.
3. **Get production credentials**:
   - `clientId`, `clientSecret`, `subscriptionKey`, `merchantSerialNumber`.
   - Save in Cloudflare Worker as secrets:
     `VIPPS_CLIENT_ID`, `VIPPS_CLIENT_SECRET`, `VIPPS_SUBSCRIPTION_KEY`,
     `VIPPS_MSN`.
4. **Test environment** is available immediately after signup —
   `apitest.vipps.no` with separate test credentials. Use this end-to-end
   before flipping the production env flag.

## API surface we'll need

Vipps eCommerce v2 API. All requests over HTTPS to
`https://api.vipps.no/ecomm/v2/` (or `apitest.vipps.no` in test).

### Initiate payment

`POST /ecomm/v2/payments`

```json
{
  "merchantInfo": {
    "merchantSerialNumber": "...",
    "callbackPrefix": "https://strikketorget.no/api/vipps/callback",
    "fallBack": "https://strikketorget.no/market/listing/<id>?paid=1",
    "isApp": false,
    "paymentType": "eComm Regular Payment"
  },
  "customerInfo": { "mobileNumber": "47XXXXXXXX" },
  "transaction": {
    "orderId": "K-<short>-<timestamp>",
    "amount": 28000,        // ører
    "transactionText": "Strikketeppe — Sofie Aas",
    "skipLandingPage": false
  }
}
```

Returns a `url` to redirect/launch the user into the Vipps app.

### Capture (analog to Stripe `paymentIntents.capture`)

`POST /ecomm/v2/payments/<orderId>/capture`

Vipps payments are **reserve** by default. We mirror our existing escrow
flow:

- Buyer initiates → reserve.
- 14-day auto-release cron OR explicit confirmation → capture.
- Refund before capture → `void`.
- Refund after capture → `refund`.

### Refund

`POST /ecomm/v2/payments/<orderId>/refund` with the amount.

### Webhook / callback

Vipps doesn't have webhooks the way Stripe does. The `callbackPrefix`
URL gets called with updates on payment status. We need:

`POST /api/vipps/callback`

Same idempotency rules apply — read the body, look up our local
`orderId`, update state, return 200.

## Code locations to add

```
src/lib/vipps.ts                  # client factory, signed-request helper
src/pages/api/vipps/init.ts       # mirror of /api/stripe/checkout for vipps
src/pages/api/vipps/callback.ts   # webhook receiver
src/pages/api/vipps/capture.ts    # internal (called by 14-day cron)
src/pages/api/vipps/refund.ts     # internal (called by refunds service)
```

## Where Vipps plugs into existing flows

| Existing | Vipps equivalent |
|---|---|
| `purchaseListing()` calls Stripe Checkout → returns redirect URL | New branch: if user picks Vipps, call Vipps init, return Vipps url |
| Webhook captures shipping address from `session.shipping_details` | Vipps doesn't carry shipping — we collect it in our own form **before** initiating Vipps (already true on listing detail) |
| Manual capture on `auto_release_at` cron | Vipps capture call alongside Stripe one |
| Refund via `stripe.paymentIntents.cancel` | Vipps void + refund branch |

## Payment-method picker

`/market/listing/[id]/checkout`-ish — present a radio:
- **Trygg betaling (kort via Stripe)** — current default
- **Vipps** — opens Vipps app

Persist the user's last choice in `localStorage` so repeat checkouts are
one click.

## Fees

Vipps charges the merchant ~2.9 % + 1.75 kr per transaction (current
public rates). We absorb this into the seller's platform fee — no
separate line item.

## Open questions

1. **MVA on platform fee**: when we charge a seller's 5–12 % cut, does
   Vipps need a separate VAT-line on that? Stripe handles via Connect's
   transfer; Vipps doesn't have a Connect equivalent. We may need to
   collect the seller's payout, then settle separately.
2. **Buyer protection vs Vipps's own buyer protection**: Vipps offers
   *Kjøperbeskyttelse* for certain merchants. We probably shouldn't
   enable it (we run our own escrow + dispute flow) — clarify with Vipps
   compliance.
3. **Test phone numbers**: the test env requires specific test MSISDNs
   (see Vipps docs). Document them in `.dev.vars.example` once we know
   them.
