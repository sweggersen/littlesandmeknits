import { describe, it, expect, vi } from 'vitest';
import {
  publishListing,
  markListingSold,
  shipListing,
  confirmListingDelivery,
} from './listings';
import type { ServiceContext } from './types';

vi.mock('../notify', () => ({
  createNotification: vi.fn(),
  notifyModeratorsNewItem: vi.fn(),
  notifyFollowersOfNewListing: vi.fn(),
}));
vi.mock('./dead-letter', () => ({ recordDeadLetter: vi.fn() }));

const stripeCapture = vi.fn();
// Default: PI is still authorized so confirmListingDelivery captures it.
const stripeRetrieve = vi.fn(async () => ({ status: 'requires_capture' }));
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({
    paymentIntents: { capture: stripeCapture, retrieve: stripeRetrieve },
  })),
}));

interface MockOpts {
  actorId: string;
  rows?: Record<string, unknown>;
  photoCount?: number;
}

function mockCtx(opts: MockOpts) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const rows = opts.rows ?? {};

  function builder(table: string) {
    return {
      select: (...selArgs: unknown[]) => {
        // Detect `.select('*', { count: 'exact', head: true })`
        const isCountHead = selArgs[1] && (selArgs[1] as any).count === 'exact';
        return {
          eq: (_c: string, _v: unknown) => {
            const tail: any = {
              maybeSingle: async () => ({ data: rows[table] ?? null }),
              single: async () => ({ data: rows[table] ?? null }),
              eq: () => tail,
              // .select(_, { count:'exact', head:true }).eq(...) awaited → { count }
              async then(cb: any) {
                if (isCountHead) return cb({ count: opts.photoCount ?? 0 });
                return cb({ data: rows[table] ?? null });
              },
            };
            return tail;
          },
          in: async () => ({ data: [] }),
        };
      },
      insert: (row: unknown) => ({
        select: () => ({
          maybeSingle: async () => {
            inserts.push({ table, row });
            return { data: { id: 'queued-1' } };
          },
          single: async () => {
            inserts.push({ table, row });
            return { data: { id: 'queued-1' } };
          },
        }),
        // Bare-await variant
        async then(cb: any) {
          inserts.push({ table, row });
          return cb({ data: null, error: null });
        },
      }),
      update: (row: unknown) => {
        const tail: any = {
          eq: () => tail,
          async then(cb: any) {
            updates.push({ table, row });
            return cb({ error: null });
          },
        };
        return tail;
      },
    };
  }

  const client = { from: (t: string) => builder(t) };
  const ctx: ServiceContext = {
    supabase: client as any,
    admin: client as any,
    user: { id: opts.actorId, email: `${opts.actorId}@x.io` },
    env: { STRIPE_SECRET_KEY: 'sk_test', PUBLIC_SITE_URL: 'https://x.io' } as any,
  };
  return { ctx, inserts, updates };
}

// ───────────────────────────── publishListing ──────────────────────

describe('publishListing — guards', () => {
  it('rejects missing id', async () => {
    const r = await publishListing(mockCtx({ actorId: 'seller' }).ctx, { listingId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('not_found when listing missing', async () => {
    const r = await publishListing(
      mockCtx({ actorId: 'seller', rows: {} }).ctx,
      { listingId: 'l1' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('not_found when listing owned by someone else', async () => {
    const r = await publishListing(
      mockCtx({
        actorId: 'attacker',
        rows: { listings: { id: 'l1', seller_id: 'seller', status: 'draft' } },
      }).ctx,
      { listingId: 'l1' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('returns ok (no-op) when listing is already published', async () => {
    const r = await publishListing(
      mockCtx({
        actorId: 'seller',
        rows: { listings: { id: 'l1', seller_id: 'seller', status: 'active' } },
      }).ctx,
      { listingId: 'l1' },
    );
    // Status is not 'draft' so service short-circuits to ok with redirect.
    expect(r.ok).toBe(true);
  });

  it('requires at least one photo before publishing', async () => {
    const r = await publishListing(
      mockCtx({
        actorId: 'seller',
        rows: { listings: { id: 'l1', seller_id: 'seller', status: 'draft' } },
        photoCount: 0,
      }).ctx,
      { listingId: 'l1' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });
});

describe('publishListing — moderation gating', () => {
  it('trusted-tier seller goes straight to active', async () => {
    const { ctx, updates } = mockCtx({
      actorId: 'seller',
      rows: {
        listings: { id: 'l1', seller_id: 'seller', status: 'draft' },
        profiles: { trust_tier: 'trusted' },
      },
      photoCount: 1,
    });
    const r = await publishListing(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(true);
    const u = updates.find((x: any) => x.table === 'listings') as any;
    expect(u.row.status).toBe('active');
    expect(u.row.published_at).not.toBeNull();
  });

  it('untrusted seller goes to pending_review and queues moderation', async () => {
    const { ctx, updates, inserts } = mockCtx({
      actorId: 'seller',
      rows: {
        listings: { id: 'l1', seller_id: 'seller', status: 'draft' },
        profiles: { trust_tier: 'new' },
      },
      photoCount: 1,
    });
    const r = await publishListing(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(true);
    const u = updates.find((x: any) => x.table === 'listings') as any;
    expect(u.row.status).toBe('pending_review');
    expect(u.row.published_at).toBeNull();
    expect(inserts.some((x: any) => x.table === 'moderation_queue')).toBe(true);
  });
});

// ───────────────────────────── markListingSold ─────────────────────

describe('markListingSold', () => {
  it('rejects missing id', async () => {
    const r = await markListingSold(mockCtx({ actorId: 'seller' }).ctx, { listingId: '' });
    expect(r.ok).toBe(false);
  });

  it('not_found when listing missing', async () => {
    const r = await markListingSold(mockCtx({ actorId: 'seller' }).ctx, { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('not_found when owned by someone else', async () => {
    const r = await markListingSold(
      mockCtx({
        actorId: 'attacker',
        rows: { listings: { id: 'l1', seller_id: 'seller', status: 'active', escrow_enabled: false } },
      }).ctx,
      { listingId: 'l1' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });
});

// ───────────────────────────── shipListing ─────────────────────────

describe('shipListing', () => {
  it('rejects missing id', async () => {
    const r = await shipListing(mockCtx({ actorId: 's' }).ctx, { listingId: '', trackingCode: 'X' });
    expect(r.ok).toBe(false);
  });

  it('not_found when not the seller', async () => {
    const r = await shipListing(
      mockCtx({
        actorId: 'attacker',
        rows: { listings: { id: 'l1', seller_id: 'seller', buyer_id: 'b', title: 't', status: 'reserved' } },
      }).ctx,
      { listingId: 'l1', trackingCode: 'X' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('rejects when not in reserved state', async () => {
    const r = await shipListing(
      mockCtx({
        actorId: 'seller',
        rows: { listings: { id: 'l1', seller_id: 'seller', buyer_id: 'b', title: 't', status: 'active' } },
      }).ctx,
      { listingId: 'l1', trackingCode: 'X' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('sets shipped + tracking + auto_release_at 14 days out', async () => {
    stripeCapture.mockClear();
    stripeCapture.mockResolvedValue({});
    const { ctx, updates } = mockCtx({
      actorId: 'seller',
      rows: { listings: { id: 'l1', seller_id: 'seller', buyer_id: 'b', title: 't', status: 'reserved', stripe_payment_intent_id: 'pi_x' } },
    });
    const r = await shipListing(ctx, { listingId: 'l1', trackingCode: 'TRK' });
    expect(r.ok).toBe(true);
    const u = updates.find((x: any) => x.table === 'listings') as any;
    expect(u.row.status).toBe('shipped');
    expect(u.row.tracking_code).toBe('TRK');
    const releaseTs = new Date(u.row.auto_release_at).getTime();
    const shippedTs = new Date(u.row.shipped_at).getTime();
    // Should be ~14 days after shipped_at.
    expect(releaseTs - shippedTs).toBeCloseTo(14 * 86400_000, -3);
  });

  it('captures the PaymentIntent when present', async () => {
    stripeCapture.mockClear();
    stripeCapture.mockResolvedValue({});
    const { ctx } = mockCtx({
      actorId: 'seller',
      rows: { listings: { id: 'l1', seller_id: 'seller', buyer_id: 'b', title: 't', status: 'reserved', stripe_payment_intent_id: 'pi_x' } },
    });
    await shipListing(ctx, { listingId: 'l1', trackingCode: 'TRK' });
    expect(stripeCapture).toHaveBeenCalledWith('pi_x');
  });

  it('blank tracking_code stored as null', async () => {
    const { ctx, updates } = mockCtx({
      actorId: 'seller',
      rows: { listings: { id: 'l1', seller_id: 'seller', buyer_id: 'b', title: 't', status: 'reserved' } },
    });
    await shipListing(ctx, { listingId: 'l1', trackingCode: '   ' });
    const u = updates.find((x: any) => x.table === 'listings') as any;
    expect(u.row.tracking_code).toBeNull();
  });

  it('H2: does NOT ship against a dead auth — releases the reservation + conflict', async () => {
    // The 7-day manual-capture auth expired before the seller shipped.
    stripeCapture.mockClear();
    stripeRetrieve.mockResolvedValueOnce({ status: 'canceled' });
    const { ctx, updates } = mockCtx({
      actorId: 'seller',
      rows: { listings: { id: 'l1', seller_id: 'seller', buyer_id: 'b', title: 't', status: 'reserved', stripe_payment_intent_id: 'pi_dead' } },
    });
    const r = await shipListing(ctx, { listingId: 'l1', trackingCode: 'TRK' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
    // Reverts to active (relisted), never marks shipped, never captures dead money.
    const u = updates.find((x: any) => x.table === 'listings') as any;
    expect(u.row.status).toBe('active');
    expect(u.row.buyer_id).toBeNull();
    expect(u.row.stripe_payment_intent_id).toBeNull();
    expect(u.row.reserved_at).toBeNull();
    expect(stripeCapture).not.toHaveBeenCalled();
  });
});

// ───────────────────────────── confirmListingDelivery ──────────────

describe('confirmListingDelivery', () => {
  it('rejects missing id', async () => {
    const r = await confirmListingDelivery(mockCtx({ actorId: 'b' }).ctx, { listingId: '' });
    expect(r.ok).toBe(false);
  });

  it('not_found when not the buyer', async () => {
    const r = await confirmListingDelivery(
      mockCtx({
        actorId: 'attacker',
        rows: { listings: { id: 'l1', seller_id: 's', buyer_id: 'buyer', title: 't', status: 'shipped' } },
      }).ctx,
      { listingId: 'l1' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('conflict when not in reserved or shipped state', async () => {
    const r = await confirmListingDelivery(
      mockCtx({
        actorId: 'buyer',
        rows: { listings: { id: 'l1', seller_id: 's', buyer_id: 'buyer', title: 't', status: 'sold' } },
      }).ctx,
      { listingId: 'l1' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('captures Stripe PaymentIntent and marks listing sold', async () => {
    stripeCapture.mockClear();
    stripeCapture.mockResolvedValue({});
    const { ctx, updates } = mockCtx({
      actorId: 'buyer',
      rows: { listings: { id: 'l1', seller_id: 's', buyer_id: 'buyer', title: 't', status: 'shipped', stripe_payment_intent_id: 'pi_real' } },
    });
    const r = await confirmListingDelivery(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(true);
    expect(stripeCapture).toHaveBeenCalledWith('pi_real');
    const u = updates.find((x: any) => x.table === 'listings') as any;
    expect(u.row.status).toBe('sold');
    expect(typeof u.row.sold_at).toBe('string');
  });

  it('does NOT re-capture a PI already captured at ship (succeeded), still marks sold', async () => {
    stripeCapture.mockClear();
    stripeRetrieve.mockResolvedValueOnce({ status: 'succeeded' });
    const { ctx, updates } = mockCtx({
      actorId: 'buyer',
      rows: { listings: { id: 'l1', seller_id: 's', buyer_id: 'buyer', title: 't', status: 'shipped', stripe_payment_intent_id: 'pi_real' } },
    });
    const r = await confirmListingDelivery(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(true);
    expect(stripeCapture).not.toHaveBeenCalled();
    expect((updates.find((x: any) => x.table === 'listings') as any).row.status).toBe('sold');
  });

  it('refuses to mark sold when the auth is no longer capturable (canceled/expired)', async () => {
    stripeCapture.mockClear();
    stripeRetrieve.mockResolvedValueOnce({ status: 'canceled' });
    const { ctx, updates } = mockCtx({
      actorId: 'buyer',
      rows: { listings: { id: 'l1', seller_id: 's', buyer_id: 'buyer', title: 't', status: 'shipped', stripe_payment_intent_id: 'pi_real' } },
    });
    const r = await confirmListingDelivery(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
    expect(stripeCapture).not.toHaveBeenCalled();
    expect(updates.find((x: any) => x.table === 'listings')).toBeUndefined();
  });

  it('skips Stripe when no PaymentIntent (non-escrow flow)', async () => {
    stripeCapture.mockClear();
    const { ctx } = mockCtx({
      actorId: 'buyer',
      rows: { listings: { id: 'l1', seller_id: 's', buyer_id: 'buyer', title: 't', status: 'shipped', stripe_payment_intent_id: null } },
    });
    const r = await confirmListingDelivery(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(true);
    expect(stripeCapture).not.toHaveBeenCalled();
  });
});
