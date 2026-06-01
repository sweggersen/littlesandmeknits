import { describe, it, expect, vi } from 'vitest';
import {
  acceptOffer,
  withdrawOffer,
  cancelCommission,
  payCommission,
  markCompleted,
  confirmDelivery,
} from './commissions';
import type { ServiceContext } from './types';

vi.mock('../notify', () => ({ createNotification: vi.fn() }));
vi.mock('./dead-letter', () => ({ recordDeadLetter: vi.fn() }));

const stripeCreate = vi.fn();
const stripeConfirm = vi.fn();
const stripeCapture = vi.fn();
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({
    paymentIntents: {
      create: stripeCreate,
      confirm: stripeConfirm,
      capture: stripeCapture,
    },
  })),
}));

interface MockOpts {
  actorId: string;
  /** Map of table -> row to return from .select().eq().maybeSingle()/.single() */
  rows?: Record<string, unknown>;
  /** Map of table+id -> row variant when multiple .eq()s are chained */
  rowsByEq?: Record<string, unknown>;
  insertRow?: { id: string } | null;
}

function mockCtx(opts: MockOpts) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const rows = opts.rows ?? {};

  function buildBuilder(table: string) {
    return {
      select: () => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => ({ data: rows[table] ?? null }),
          single: async () => ({ data: rows[table] ?? null }),
          eq: (_c2: string, _v2: unknown) => ({
            select: () => ({ async then(cb: any) { return cb({ data: [] }); } }),
            neq: () => ({
              select: async () => ({ data: [] }),
            }),
          }),
          neq: () => ({
            select: async () => ({ data: [] }),
          }),
        }),
        in: async () => ({ data: [] }),
      }),
      insert: (row: unknown) => ({
        select: () => ({
          single: async () => {
            inserts.push({ table, row });
            return { data: opts.insertRow ?? { id: 'proj-new' }, error: null };
          },
          maybeSingle: async () => {
            inserts.push({ table, row });
            return { data: opts.insertRow ?? null, error: null };
          },
        }),
      }),
      update: (row: unknown) => ({
        eq: (_c: string, _v: unknown) => {
          // Chain may be .update().eq().eq().neq().select() (acceptOffer
          // declining the losers) — return a tail that satisfies all
          // these without exploding.
          updates.push({ table, row });
          const tail: any = {
            eq: () => tail,
            neq: () => ({
              select: async () => ({ data: [] }),
            }),
            // Some call sites await directly: .update().eq() — promise.
            then(cb: any) { return cb({ error: null }); },
          };
          return tail;
        },
      }),
    };
  }

  const client = { from: (t: string) => buildBuilder(t) };
  const ctx: ServiceContext = {
    supabase: client as any,
    admin: client as any,
    user: { id: opts.actorId, email: `${opts.actorId}@x.io` },
    env: { STRIPE_SECRET_KEY: 'sk_test', PUBLIC_SITE_URL: 'https://x.io' } as any,
  };
  return { ctx, inserts, updates };
}

// ───────────────────────────── acceptOffer ─────────────────────────

describe('acceptOffer', () => {
  it('rejects missing offerId', async () => {
    const r = await acceptOffer(mockCtx({ actorId: 'b' }).ctx, { offerId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('not_found when offer missing', async () => {
    const r = await acceptOffer(mockCtx({ actorId: 'b' }).ctx, { offerId: 'o1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('forbids non-buyer', async () => {
    const { ctx } = mockCtx({
      actorId: 'attacker',
      rows: {
        commission_offers: { id: 'o1', request_id: 'r1', status: 'pending', knitter_id: 'k', project_id: null },
        commission_requests: { id: 'r1', buyer_id: 'buyer', status: 'open', title: 't' },
      },
    });
    const r = await acceptOffer(ctx, { offerId: 'o1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('rejects when request not open or offer not pending', async () => {
    const { ctx } = mockCtx({
      actorId: 'buyer',
      rows: {
        commission_offers: { id: 'o1', request_id: 'r1', status: 'declined', knitter_id: 'k', project_id: null },
        commission_requests: { id: 'r1', buyer_id: 'buyer', status: 'open', title: 't' },
      },
    });
    const r = await acceptOffer(ctx, { offerId: 'o1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });
});

// ───────────────────────────── withdrawOffer ────────────────────────

describe('withdrawOffer', () => {
  it('rejects missing offerId', async () => {
    const r = await withdrawOffer(mockCtx({ actorId: 'k' }).ctx, { offerId: '' });
    expect(r.ok).toBe(false);
  });

  it('forbids non-knitter (not the offer owner)', async () => {
    const { ctx } = mockCtx({
      actorId: 'attacker',
      rows: { commission_offers: { id: 'o1', request_id: 'r1', knitter_id: 'k', status: 'pending' } },
    });
    const r = await withdrawOffer(ctx, { offerId: 'o1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('refuses to withdraw a non-pending offer', async () => {
    const { ctx } = mockCtx({
      actorId: 'k',
      rows: { commission_offers: { id: 'o1', request_id: 'r1', knitter_id: 'k', status: 'accepted' } },
    });
    const r = await withdrawOffer(ctx, { offerId: 'o1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('updates offer to withdrawn for the knitter who owns it', async () => {
    const { ctx, updates } = mockCtx({
      actorId: 'k',
      rows: { commission_offers: { id: 'o1', request_id: 'r1', knitter_id: 'k', status: 'pending' } },
    });
    const r = await withdrawOffer(ctx, { offerId: 'o1' });
    expect(r.ok).toBe(true);
    const u = updates.find((x: any) => x.table === 'commission_offers') as any;
    expect(u.row).toEqual({ status: 'withdrawn' });
  });
});

// ───────────────────────────── cancelCommission ─────────────────────

describe('cancelCommission', () => {
  it('rejects missing requestId', async () => {
    const r = await cancelCommission(mockCtx({ actorId: 'b' }).ctx, { requestId: '' });
    expect(r.ok).toBe(false);
  });

  it('forbids non-buyer', async () => {
    const { ctx } = mockCtx({
      actorId: 'attacker',
      rows: { commission_requests: { id: 'r1', buyer_id: 'buyer', status: 'open' } },
    });
    const r = await cancelCommission(ctx, { requestId: 'r1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });
});

// ───────────────────────────── payCommission ────────────────────────

describe('payCommission', () => {
  it('rejects missing requestId', async () => {
    const r = await payCommission(mockCtx({ actorId: 'b' }).ctx, { requestId: '' });
    expect(r.ok).toBe(false);
  });

  it('forbids non-buyer', async () => {
    const { ctx } = mockCtx({
      actorId: 'attacker',
      rows: {
        commission_requests: { id: 'r1', buyer_id: 'buyer', status: 'awaiting_payment' },
      },
    });
    const r = await payCommission(ctx, { requestId: 'r1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('rejects when status is not awaiting_payment', async () => {
    const { ctx } = mockCtx({
      actorId: 'buyer',
      rows: {
        commission_requests: { id: 'r1', buyer_id: 'buyer', status: 'open' },
      },
    });
    const r = await payCommission(ctx, { requestId: 'r1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });
});

// ───────────────────────────── markCompleted ────────────────────────

describe('markCompleted', () => {
  it('rejects missing requestId', async () => {
    const r = await markCompleted(mockCtx({ actorId: 'k' }).ctx, { requestId: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects when status is not awarded', async () => {
    const { ctx } = mockCtx({
      actorId: 'k',
      rows: {
        commission_requests: { id: 'r1', buyer_id: 'b', status: 'completed', title: 't', awarded_offer_id: 'o1' },
      },
    });
    const r = await markCompleted(ctx, { requestId: 'r1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('forbids non-knitter', async () => {
    const { ctx } = mockCtx({
      actorId: 'attacker',
      rows: {
        commission_requests: { id: 'r1', buyer_id: 'b', status: 'awarded', title: 't', awarded_offer_id: 'o1' },
        commission_offers: { knitter_id: 'k' },
      },
    });
    const r = await markCompleted(ctx, { requestId: 'r1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('sets auto_release_at 14 days out and persists tracking_code', async () => {
    const { ctx, updates } = mockCtx({
      actorId: 'k',
      rows: {
        commission_requests: { id: 'r1', buyer_id: 'b', status: 'awarded', title: 't', awarded_offer_id: 'o1' },
        commission_offers: { knitter_id: 'k' },
      },
    });
    const before = Date.now();
    const r = await markCompleted(ctx, { requestId: 'r1', trackingCode: 'TRK-123' });
    expect(r.ok).toBe(true);
    const u = updates.find((x: any) => x.table === 'commission_requests') as any;
    expect(u.row.status).toBe('completed');
    expect(u.row.finished_item_tracking_code).toBe('TRK-123');
    const releaseTs = new Date(u.row.auto_release_at).getTime();
    // Should be ~14 days from now, within ±1 hour for clock skew.
    const expected = before + 14 * 86400_000;
    expect(Math.abs(releaseTs - expected)).toBeLessThan(3_600_000);
  });
});

// ───────────────────────────── confirmDelivery ──────────────────────

describe('confirmDelivery', () => {
  it('rejects missing requestId', async () => {
    const r = await confirmDelivery(mockCtx({ actorId: 'b' }).ctx, { requestId: '' });
    expect(r.ok).toBe(false);
  });

  it('forbids non-buyer', async () => {
    const { ctx } = mockCtx({
      actorId: 'attacker',
      rows: {
        commission_requests: { id: 'r1', buyer_id: 'buyer', status: 'completed', title: 't', awarded_offer_id: 'o1', stripe_payment_intent_id: 'pi' },
      },
    });
    const r = await confirmDelivery(ctx, { requestId: 'r1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('rejects when not completed', async () => {
    const { ctx } = mockCtx({
      actorId: 'buyer',
      rows: {
        commission_requests: { id: 'r1', buyer_id: 'buyer', status: 'awarded', title: 't', awarded_offer_id: 'o1', stripe_payment_intent_id: 'pi' },
      },
    });
    const r = await confirmDelivery(ctx, { requestId: 'r1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('captures the Stripe payment intent on success', async () => {
    stripeCapture.mockClear();
    stripeCapture.mockResolvedValue({});
    const { ctx } = mockCtx({
      actorId: 'buyer',
      rows: {
        commission_requests: { id: 'r1', buyer_id: 'buyer', status: 'completed', title: 't', awarded_offer_id: 'o1', stripe_payment_intent_id: 'pi_real' },
        commission_offers: { knitter_id: 'k' },
      },
    });
    const r = await confirmDelivery(ctx, { requestId: 'r1' });
    expect(r.ok).toBe(true);
    expect(stripeCapture).toHaveBeenCalledWith('pi_real');
  });

  it('skips Stripe capture when no payment intent (test-mode commission)', async () => {
    stripeCapture.mockClear();
    const { ctx } = mockCtx({
      actorId: 'buyer',
      rows: {
        commission_requests: { id: 'r1', buyer_id: 'buyer', status: 'completed', title: 't', awarded_offer_id: 'o1', stripe_payment_intent_id: null },
        commission_offers: { knitter_id: 'k' },
      },
    });
    const r = await confirmDelivery(ctx, { requestId: 'r1' });
    expect(r.ok).toBe(true);
    expect(stripeCapture).not.toHaveBeenCalled();
  });
});
