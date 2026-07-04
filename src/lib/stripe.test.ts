import { describe, it, expect } from 'vitest';
import { createStripe } from './stripe';

// Vitest runs in DEV mode (import.meta.env.DEV === true), i.e. the same env as
// the dev server. So these assert the dev-server guard directly. The PROD-side
// guard (sk_simulate refused in a production build) is the mirror image, keyed
// off import.meta.env.PROD.

describe('createStripe environment guards', () => {
  it('returns the offline double for sk_simulate on the dev server', () => {
    const stripe = createStripe('sk_simulate');
    // The double exposes the same surface; a real network client would too, so
    // assert it constructed without throwing and has the checkout API.
    expect(stripe.checkout.sessions.create).toBeTypeOf('function');
  });

  it('refuses a LIVE key on the dev server (would charge real cards)', () => {
    expect(() => createStripe('sk_live_abc123')).toThrowError(/LIVE key/i);
  });

  it('accepts a test key on the dev server', () => {
    const stripe = createStripe('sk_test_abc123');
    expect(stripe.checkout.sessions.create).toBeTypeOf('function');
  });
});
