import Stripe from 'stripe';
import { SIMULATE_STRIPE_KEY, createSimulatedStripe } from './stripe-sim';

export function createStripe(secretKey: string): Stripe {
  // Flow-simulation sentinel: the test harness sets STRIPE_SECRET_KEY to this
  // to run the full money state machine deterministically, no network. A real
  // prod key never equals it, so production behaviour is unchanged.
  if (secretKey === SIMULATE_STRIPE_KEY) return createSimulatedStripe();
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
