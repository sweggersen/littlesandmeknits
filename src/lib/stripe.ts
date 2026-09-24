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

  // A "live" key is either a full secret key (sk_live_) OR a RESTRICTED key
  // (rk_live_) — restricted keys are the recommended production setup, so both
  // must count as live. (Test-mode equivalents are sk_test_ / rk_test_.)
  const isLiveKey = secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_');

  // Never let a LIVE key run on the dev server — that would charge real cards
  // during local testing. Use a test key (sk_test_/rk_test_) or sk_simulate.
  if (import.meta.env.DEV && isLiveKey) {
    throw new Error('Stripe: refusing to use a LIVE key on the dev server. Use a test key (sk_test_/rk_test_) or sk_simulate in .dev.vars.');
  }

  // Symmetric guard: a PRODUCTION build MUST use a live key. A stray test key in
  // prod silently routes real buyers through Stripe TEST mode (test cards only),
  // so checkout breaks with no loud failure. sk_simulate is already thrown above.
  if (import.meta.env.PROD && !isLiveKey) {
    throw new Error('Stripe: production build requires a LIVE key (sk_live_ or rk_live_). Got a non-live key — set the prod STRIPE_SECRET_KEY secret.');
  }

  return new Stripe(secretKey, {
    // Pin the API version the SDK v22 types are generated for. Without this,
    // calls ride the *account* default (an ancient 2017-01-27 on this account),
    // so runtime response/webhook shapes drifted from the modern TypeScript
    // types. Keep this aligned with the webhook endpoint's API version.
    apiVersion: '2026-04-22.dahlia',
    httpClient: Stripe.createFetchHttpClient(),
    typescript: true,
    // The SDK default (~80s) is far too long for a Worker invocation; bound each
    // Stripe call so a slow Stripe can't hang the request. Retries handle blips.
    timeout: 20_000,
    maxNetworkRetries: 1,
  });
}
