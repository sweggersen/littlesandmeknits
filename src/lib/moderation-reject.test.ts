import { describe, it, expect, vi } from 'vitest';

// recalculateTrust makes many admin calls we don't care about here.
vi.mock('./trust', () => ({ recalculateTrust: vi.fn(async () => {}) }));

import { applyRejection } from './moderation';

// Minimal recording admin: enough for the listing-rejection path + the
// dead_letter insert that the refund-failure now produces.
function mockAdmin(sessionId: string | null) {
  const deadLetters: any[] = [];
  const admin = {
    rpc: async () => ({ error: null }),
    from: (table: string) => ({
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === 'listings' ? { listing_fee_session_id: sessionId } : {} }) }),
      }),
      insert: async (row: any) => { if (table === 'dead_letter_events') deadLetters.push(row); return { error: null }; },
    }),
  };
  return { admin, deadLetters };
}

const qi = { item_type: 'listing', item_id: 'l1', submitter_id: 'u1', rejection_reason: 'nope' } as any;

describe('applyRejection — listing-fee refund failure', () => {
  it('dead-letters a failed refund instead of swallowing it, and still completes the rejection', async () => {
    const { admin, deadLetters } = mockAdmin('cs_test_1');
    const notify = vi.fn(async () => {});
    const createStripe = () => ({
      checkout: { sessions: { retrieve: async () => ({ payment_intent: 'pi_1' }) } },
      refunds: { create: async () => { throw new Error('stripe down'); } },
    });

    await applyRejection(admin as any, qi, 'actor-1', {}, notify as any, { stripeSecretKey: 'sk_test', createStripe });

    // The failure landed in dead_letter_events (auditable), not just a console line.
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].service).toContain('listing_fee_refund');
    expect(deadLetters[0].context).toMatchObject({ listing_id: 'l1', session_id: 'cs_test_1' });
    // The rejection itself still succeeded (submitter notified).
    expect(notify).toHaveBeenCalledOnce();
  });

  it('does not dead-letter when there is no fee session to refund', async () => {
    const { admin, deadLetters } = mockAdmin(null);
    const notify = vi.fn(async () => {});
    const createStripe = () => ({ checkout: { sessions: { retrieve: async () => ({}) } }, refunds: { create: async () => ({}) } });

    await applyRejection(admin as any, qi, 'actor-1', {}, notify as any, { stripeSecretKey: 'sk_test', createStripe });

    expect(deadLetters).toHaveLength(0);
    expect(notify).toHaveBeenCalledOnce();
  });
});
