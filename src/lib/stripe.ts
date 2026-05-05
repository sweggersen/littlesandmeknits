import Stripe from 'stripe';

export function createStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    typescript: true,
  });
}
