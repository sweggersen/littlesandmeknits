import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promoteListing } from './promotions';
import type { ServiceContext } from './types';

vi.mock('../flags', () => ({ killGuard: vi.fn(async () => null) }));

const sessionsCreate = vi.fn(async (_args?: any): Promise<any> => ({ id: 'cs_new', url: 'https://checkout/new' }));
const sessionsRetrieve = vi.fn(async (): Promise<any> => ({ status: 'open', payment_status: 'unpaid', url: 'https://checkout/existing' }));
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({
    checkout: { sessions: { create: sessionsCreate, retrieve: sessionsRetrieve } },
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  sessionsCreate.mockResolvedValue({ id: 'cs_new', url: 'https://checkout/new' });
  sessionsRetrieve.mockResolvedValue({ status: 'open', payment_status: 'unpaid', url: 'https://checkout/existing' });
});

const ACTIVE_LISTING = { id: 'l1', seller_id: 'seller-1', title: 'Genser', status: 'active', promoted_until: null };

/** Stub whose reads return the listing + an optional pending promotion row, and
 *  records inserts so we can assert whether a NEW pending row was written. */
function mockCtx(opts: { listing?: unknown; pending?: unknown; insertErr?: unknown } = {}) {
  const inserts: unknown[] = [];
  const admin = {
    from: (t: string) => ({
      select: () => {
        const sel: any = {
          eq: () => sel,
          order: () => sel,
          limit: () => sel,
          maybeSingle: async () =>
            t === 'listing_promotions'
              ? { data: opts.pending ?? null }
              : { data: opts.listing ?? null },
        };
        return sel;
      },
      insert: async (row: unknown) => {
        inserts.push({ table: t, row });
        return { error: opts.insertErr ?? null };
      },
    }),
  };
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.listing ?? null }) }) }),
    }),
  };
  const ctx = {
    supabase: supabase as any,
    admin: admin as any,
    user: { id: 'seller-1', email: 's@x.io' },
    env: { STRIPE_SECRET_KEY: 'sk_test', PUBLIC_SITE_URL: 'https://site' } as any,
  } as ServiceContext;
  return { ctx, inserts };
}

describe('promoteListing — double-charge guard', () => {
  it('mints a fresh capturable session with a bounded expiry when none is pending', async () => {
    const { ctx, inserts } = mockCtx({ listing: ACTIVE_LISTING, pending: null });
    const r = await promoteListing(ctx, { listingId: 'l1', tier: 'boost' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toBe('https://checkout/new');
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    // Bounded so an abandoned checkout can't be paid days later (duplicate charge).
    expect((sessionsCreate.mock.calls[0][0] as any).expires_at).toEqual(expect.any(Number));
    expect(inserts).toHaveLength(1);
  });

  it('REUSES an open pending session instead of minting a second one', async () => {
    const { ctx, inserts } = mockCtx({
      listing: ACTIVE_LISTING,
      pending: { id: 'p1', stripe_session_id: 'cs_open' },
    });
    const r = await promoteListing(ctx, { listingId: 'l1', tier: 'boost' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toBe('https://checkout/existing');
    // No second capturable session, no second pending row.
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('does NOT double-charge when the pending session is already paid', async () => {
    sessionsRetrieve.mockResolvedValueOnce({ status: 'complete', payment_status: 'paid', url: null });
    const { ctx, inserts } = mockCtx({
      listing: ACTIVE_LISTING,
      pending: { id: 'p1', stripe_session_id: 'cs_paid' },
    });
    const r = await promoteListing(ctx, { listingId: 'l1', tier: 'boost' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.redirect).toContain('?promoted=1');
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('mints fresh when the pending session has expired', async () => {
    sessionsRetrieve.mockResolvedValueOnce({ status: 'expired', payment_status: 'unpaid', url: null });
    const { ctx } = mockCtx({
      listing: ACTIVE_LISTING,
      pending: { id: 'p1', stripe_session_id: 'cs_expired' },
    });
    const r = await promoteListing(ctx, { listingId: 'l1', tier: 'boost' });
    expect(r.ok).toBe(true);
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
  });

  it('does NOT send the seller to checkout when the pending-row insert fails', async () => {
    // Insert failing would leave the seller charged with no row for the webhook
    // to activate — surface the error instead of redirecting to Stripe.
    const { ctx } = mockCtx({ listing: ACTIVE_LISTING, pending: null, insertErr: { message: 'db down' } });
    const r = await promoteListing(ctx, { listingId: 'l1', tier: 'boost' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('server_error');
  });
});
