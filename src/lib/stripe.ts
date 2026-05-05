import Stripe from 'stripe';

export function createStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: '2025-11-10.spring',
    httpClient: Stripe.createFetchHttpClient(),
    typescript: true,
  });
}
