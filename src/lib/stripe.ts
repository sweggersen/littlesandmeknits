import Stripe from 'stripe';
import { SIMULATE_STRIPE_KEY, createSimulatedStripe } from './stripe-sim';

export function createStripe(secretKey: string): Stripe {
  // ── Environment guards ────────────────────────────────────────────────────
  // import.meta.env.DEV is true on the dev server (local `astro dev` AND the CI
  // e2e job); a real production deploy is a build, so PROD is true there. These
  // two checks prevent the only genuinely harmful key/environment mismatches.

  // Flow-simulation sentinel: the test harness sets STRIPE_SECRET_KEY to this
  // to run the full money state machine deterministically, no network. A real
  // prod key never equals it, so production behaviour is unchanged. But if it
  // ever reached a PRODUCTION build it would silently FAKE payments (sellers
  // "paid", buyers charged nothing) — fail loud instead.
  if (secretKey === SIMULATE_STRIPE_KEY) {
    if (import.meta.env.PROD) {
      throw new Error('Stripe: sk_simulate reached a production build — refusing to fake payments in prod. Set a live key (sk_live_) as the STRIPE_SECRET_KEY secret.');
    }
    return createSimulatedStripe();
  }

  // Never let a LIVE key run on the dev server — that would charge real cards
  // during local testing. Use sk_test_ (real Stripe test mode) or sk_simulate
  // locally; sk_live_ belongs only in the production deploy.
  if (import.meta.env.DEV && secretKey.startsWith('sk_live_')) {
    throw new Error('Stripe: refusing to use a LIVE key (sk_live_) on the dev server. Use a test key (sk_test_) or sk_simulate in .dev.vars.');
  }

  return new Stripe(secretKey, {
    // Pin the API version the SDK v22 types are generated for. Without this,
    // calls ride the *account* default (an ancient 2017-01-27 on this account),
    // so runtime response/webhook shapes drifted from the modern TypeScript
    // types. Keep this aligned with the webhook endpoint's API version.
    apiVersion: '2026-04-22.dahlia',
    httpClient: Stripe.createFetchHttpClient(),
    typescript: true,
  });
}
