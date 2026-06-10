import Stripe from 'stripe';

export function createStripe(secretKey: string): Stripe {
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
