import { describe, it, expect, vi } from 'vitest';
import { requestRefund, respondToRefund } from './refunds';
import type { ServiceContext } from './types';

vi.mock('../notify', () => ({ createNotification: vi.fn() }));
const piCancel = vi.fn().mockResolvedValue({});
const refundCreate = vi.fn().mockResolvedValue({});
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({
    paymentIntents: { cancel: piCancel },
    refunds: { create: refundCreate },
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
  // The order is the source of truth now; derive it from the listing fixture so
  // the existing test data (refund/PI on the listing row) keeps describing it.
  const order = opts.listing ? {
    id: 'o1', listing_id: opts.listing.id,
    status: opts.listing.status === 'sold' ? 'delivered' : opts.listing.status,
    stripe_payment_intent_id: opts.listing.stripe_payment_intent_id ?? null,
    refund_requested_at: opts.listing.refund_requested_at ?? null,
    refund_reason: opts.listing.refund_reason ?? null,
  } : null;
  const client = {
    from: (table: string) => ({
      select: () => {
        // Chainable .eq().in().maybeSingle() (findOpenOrder uses .in('status')).
        const sel: any = {
          eq: () => sel,
          in: () => sel,
          maybeSingle: async () => {
            if (table === 'listings') return { data: opts.listing ?? null };
            if (table === 'orders') return { data: order };
            return { data: null };
          },
          async then(cb: any) { return cb({ data: [] }); },
        };
        return sel;
      },
      insert: async (row: unknown) => {
        inserts.push({ table, row });
        return { error: null };
      },
      update: (row: unknown) => {
        // Chainable .eq().eq().in()[.select()]; records on the terminal.
        // updateOpenOrder ends in .select('id').maybeSingle() (returns the
        // order id for the ledger); listing updates just await (.then).
        const tail: any = {
          eq: () => tail,
          in: () => tail,
          select: () => tail,
          maybeSingle: async () => {
            updates.push({ table, row });
            return { data: table === 'orders' ? order : null, error: null };
          },
          async then(cb: any) {
            updates.push({ table, row });
            return cb({ data: table === 'orders' && order ? [order] : [], error: null });
          },
        };
        return tail;
      },
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

      // The refund request is recorded on the order now.
      const u = updates.find((x: any) => x.table === 'orders') as any;
      expect(u.row).toMatchObject({ refund_reason: 'damaged', refund_description: 'tear at the seam' });
      expect(typeof u.row.refund_requested_at).toBe('string');
    }
  });

  it('truncates description to 1000 chars', async () => {
    const { ctx, updates } = mockCtx({ actorId: 'buyer', listing: aListing });
    await requestRefund(ctx, { listingId: 'l1', reason: 'damaged', description: 'x'.repeat(5000) });
    const u = updates.find((x: any) => x.table === 'orders') as any;
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
    const { ctx, updates, inserts } = mockCtx({ actorId: 'seller', listing: pendingRefund });
    const r = await respondToRefund(ctx, { listingId: 'l1', action: 'accept', notes: 'agreed' });
    expect(r.ok).toBe(true);

    // Catalog row back to active + holder cleared.
    const l = updates.find((x: any) => x.table === 'listings') as any;
    expect(l.row).toMatchObject({ status: 'active', buyer_id: null });
    // Order keeps the cancelled + refund record.
    const o = updates.find((x: any) => x.table === 'orders') as any;
    expect(o.row).toMatchObject({
      status: 'cancelled', cancel_reason: 'refund_accepted',
      refund_outcome: 'accepted', refund_notes: 'agreed',
    });
    // Ledger: a 'refunded' event, tagged as the seller's decision.
    const ev = inserts.find((x: any) => x.table === 'payment_events') as any;
    expect(ev.row).toMatchObject({
      kind: 'listing', event_type: 'refunded', order_id: 'o1', actor_id: 'seller',
      context: { trigger: 'seller_accepted' },
    });
  });

  it('on accept of a CAPTURED charge: full refund reverses the transfer + app fee', async () => {
    piCancel.mockClear();
    refundCreate.mockClear();
    // Captured PI → cancel throws → refund path runs.
    piCancel.mockRejectedValueOnce(new Error('payment_intent_unexpected_state'));
    const { ctx } = mockCtx({ actorId: 'seller', listing: pendingRefund });
    const r = await respondToRefund(ctx, { listingId: 'l1', action: 'accept' });
    expect(r.ok).toBe(true);
    expect(refundCreate).toHaveBeenCalledWith({
      payment_intent: 'pi_test',
      reverse_transfer: true,
      refund_application_fee: true,
    });
  });

  it('on decline: flips status to disputed + records outcome', async () => {
    const { ctx, updates, inserts } = mockCtx({ actorId: 'seller', listing: pendingRefund });
    const r = await respondToRefund(ctx, { listingId: 'l1', action: 'decline', notes: 'no damage seen' });
    expect(r.ok).toBe(true);

    expect((updates.find((x: any) => x.table === 'listings') as any).row.status).toBe('disputed');
    const o = updates.find((x: any) => x.table === 'orders') as any;
    expect(o.row).toMatchObject({ status: 'disputed', refund_outcome: 'declined' });
    // The buyer's reason renders as its Norwegian label, not the raw enum.
    expect(o.row.dispute_reason).toContain('Skadet');
    expect(o.row.dispute_reason).not.toContain('damaged');
    expect(o.row.dispute_reason).toContain('no damage seen');
    // Ledger: a 'dispute_opened' event, tagged as a declined refund.
    const ev = inserts.find((x: any) => x.table === 'payment_events') as any;
    expect(ev.row).toMatchObject({
      kind: 'listing', event_type: 'dispute_opened', order_id: 'o1',
      context: { trigger: 'refund_declined' },
    });
  });
});
