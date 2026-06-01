import { describe, it, expect, vi } from 'vitest';
import { requestRefund, respondToRefund } from './refunds';
import type { ServiceContext } from './types';

vi.mock('../notify', () => ({ createNotification: vi.fn() }));
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({
    paymentIntents: { cancel: vi.fn().mockResolvedValue({}) },
    refunds: { create: vi.fn().mockResolvedValue({}) },
  })),
}));

interface ListingRow {
  id: string;
  buyer_id: string | null;
  seller_id: string;
  title: string;
  status: string;
  refund_requested_at?: string | null;
  refund_reason?: string | null;
  stripe_payment_intent_id?: string | null;
}

function mockCtx(opts: { actorId: string; listing?: ListingRow | null }) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'listings') return { data: opts.listing ?? null };
            return { data: null };
          },
        }),
        in: async () => ({ data: [] }),
      }),
      insert: async (row: unknown) => {
        inserts.push({ table, row });
        return { error: null };
      },
      update: (row: unknown) => ({
        eq: async () => {
          updates.push({ table, row });
          return { error: null };
        },
      }),
    }),
  };
  const ctx: ServiceContext = {
    supabase: client as any,
    admin: client as any,
    user: { id: opts.actorId, email: `${opts.actorId}@x.io` },
    env: { STRIPE_SECRET_KEY: 'sk_test', RESEND_API_KEY: '', PUBLIC_SITE_URL: '', VAPID_PRIVATE_KEY: '', PUBLIC_VAPID_KEY: '' } as any,
  };
  return { ctx, inserts, updates };
}

const aListing: ListingRow = {
  id: 'l1', buyer_id: 'buyer', seller_id: 'seller',
  title: 'Test sweater', status: 'reserved',
  refund_requested_at: null,
  stripe_payment_intent_id: 'pi_test',
};

describe('requestRefund — input + auth', () => {
  it('rejects missing listingId', async () => {
    const r = await requestRefund(mockCtx({ actorId: 'buyer' }).ctx, { listingId: '', reason: 'damaged' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects unknown reason', async () => {
    const r = await requestRefund(mockCtx({ actorId: 'buyer' }).ctx, { listingId: 'l1', reason: 'because' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('returns not_found when listing missing', async () => {
    const r = await requestRefund(mockCtx({ actorId: 'buyer', listing: null }).ctx, {
      listingId: 'l1', reason: 'damaged',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('forbids non-buyer', async () => {
    const r = await requestRefund(
      mockCtx({ actorId: 'someone-else', listing: aListing }).ctx,
      { listingId: 'l1', reason: 'damaged' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });
});

describe('requestRefund — state machine', () => {
  it('rejects when listing is draft / active / pending', async () => {
    for (const status of ['draft', 'active', 'pending_review']) {
      const r = await requestRefund(
        mockCtx({ actorId: 'buyer', listing: { ...aListing, status } }).ctx,
        { listingId: 'l1', reason: 'damaged' },
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('conflict');
    }
  });

  it('rejects when refund already requested', async () => {
    const r = await requestRefund(
      mockCtx({ actorId: 'buyer', listing: { ...aListing, refund_requested_at: new Date().toISOString() } }).ctx,
      { listingId: 'l1', reason: 'damaged' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('accepts at reserved / shipped / sold and records the request', async () => {
    for (const status of ['reserved', 'shipped', 'sold']) {
      const { ctx, updates } = mockCtx({ actorId: 'buyer', listing: { ...aListing, status } });
      const r = await requestRefund(ctx, { listingId: 'l1', reason: 'damaged', description: 'tear at the seam' });
      expect(r.ok, `status=${status}`).toBe(true);

      const u = updates.find((x: any) => x.table === 'listings') as any;
      expect(u.row).toMatchObject({ refund_reason: 'damaged', refund_description: 'tear at the seam' });
      expect(typeof u.row.refund_requested_at).toBe('string');
    }
  });

  it('truncates description to 1000 chars', async () => {
    const { ctx, updates } = mockCtx({ actorId: 'buyer', listing: aListing });
    await requestRefund(ctx, { listingId: 'l1', reason: 'damaged', description: 'x'.repeat(5000) });
    const u = updates.find((x: any) => x.table === 'listings') as any;
    expect(u.row.refund_description).toHaveLength(1000);
  });
});

describe('respondToRefund', () => {
  const pendingRefund: ListingRow = {
    ...aListing,
    refund_requested_at: new Date().toISOString(),
    refund_reason: 'damaged',
  };

  it('rejects unknown action', async () => {
    const r = await respondToRefund(
      mockCtx({ actorId: 'seller', listing: pendingRefund }).ctx,
      { listingId: 'l1', action: 'maybe' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('forbids non-seller', async () => {
    const r = await respondToRefund(
      mockCtx({ actorId: 'someone-else', listing: pendingRefund }).ctx,
      { listingId: 'l1', action: 'accept' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('rejects when no refund request is active', async () => {
    const r = await respondToRefund(
      mockCtx({ actorId: 'seller', listing: aListing }).ctx,
      { listingId: 'l1', action: 'accept' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('on accept: returns listing to active + clears buyer + records outcome', async () => {
    const { ctx, updates } = mockCtx({ actorId: 'seller', listing: pendingRefund });
    const r = await respondToRefund(ctx, { listingId: 'l1', action: 'accept', notes: 'agreed' });
    expect(r.ok).toBe(true);

    const u = updates.find((x: any) => x.table === 'listings') as any;
    expect(u.row).toMatchObject({
      status: 'active', buyer_id: null,
      refund_outcome: 'accepted', refund_notes: 'agreed',
    });
    // Resets the purchase trail so the listing can be re-bought.
    expect(u.row.reserved_at).toBeNull();
    expect(u.row.stripe_payment_intent_id).toBeNull();
  });

  it('on decline: flips status to disputed + records outcome', async () => {
    const { ctx, updates } = mockCtx({ actorId: 'seller', listing: pendingRefund });
    const r = await respondToRefund(ctx, { listingId: 'l1', action: 'decline', notes: 'no damage seen' });
    expect(r.ok).toBe(true);

    const u = updates.find((x: any) => x.table === 'listings') as any;
    expect(u.row).toMatchObject({
      status: 'disputed',
      refund_outcome: 'declined',
    });
    expect(u.row.dispute_reason).toContain('damaged');
    expect(u.row.dispute_reason).toContain('no damage seen');
  });
});
