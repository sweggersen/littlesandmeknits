import { describe, it, expect, vi } from 'vitest';
import { resolveDispute } from './disputes';
import type { ServiceContext } from './types';

vi.mock('../notify', () => ({ createNotification: vi.fn() }));

const stripeCancel = vi.fn().mockResolvedValue({});
const stripeCapture = vi.fn().mockResolvedValue({});
// Commission PIs default to the new rail (captured into the platform balance).
const stripeRetrieve = vi.fn(async (): Promise<any> => ({ status: 'succeeded', transfer_data: null, latest_charge: 'ch_1' }));
const stripeRefundCreate = vi.fn().mockResolvedValue({});
const stripeTransferCreate = vi.fn(async () => ({ id: 'tr_1' }));
vi.mock('../stripe', () => ({
  createStripe: vi.fn(() => ({
    paymentIntents: { cancel: stripeCancel, capture: stripeCapture, retrieve: stripeRetrieve },
    refunds: { create: stripeRefundCreate },
    transfers: { create: stripeTransferCreate },
  })),
}));

interface MockOpts {
  role?: string | null;
  listing?: any;
  request?: any;
  offer?: any;
}

function mockCtx(opts: MockOpts = {}) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'profiles') return { data: { role: opts.role ?? null } };
            if (table === 'listings') return { data: opts.listing ?? null };
            if (table === 'commission_requests') return { data: opts.request ?? null };
            if (table === 'commission_offers') return { data: opts.offer ?? null };
            if (table === 'seller_profiles') return { data: { stripe_account_id: 'acct_k' } };
            return { data: null };
          },
        }),
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
    user: { id: 'admin-1', email: 'admin@x.io' },
    env: { STRIPE_SECRET_KEY: 'sk_test' } as any,
  };
  return { ctx, inserts, updates };
}

describe('resolveDispute — guards', () => {
  it('rejects missing itemId', async () => {
    const r = await resolveDispute(mockCtx({ role: 'admin' }).ctx, {
      itemType: 'listing', itemId: '', decision: 'refund',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects invalid decision', async () => {
    const r = await resolveDispute(mockCtx({ role: 'admin' }).ctx, {
      itemType: 'listing', itemId: 'l1', decision: 'maybe',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('forbids non-admin', async () => {
    const r = await resolveDispute(mockCtx({ role: 'moderator' }).ctx, {
      itemType: 'listing', itemId: 'l1', decision: 'refund',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('rejects unknown item type', async () => {
    const r = await resolveDispute(mockCtx({ role: 'admin' }).ctx, {
      itemType: 'pattern', itemId: 'x', decision: 'refund',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });
});

describe('resolveDispute — listing', () => {
  const disputedListing = {
    id: 'l1', seller_id: 's', buyer_id: 'b',
    title: 'Sweater', status: 'disputed', stripe_payment_intent_id: 'pi_x',
  };

  it('not_found when listing missing', async () => {
    const r = await resolveDispute(mockCtx({ role: 'admin', listing: null }).ctx, {
      itemType: 'listing', itemId: 'l1', decision: 'refund',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('conflict when listing not in disputed state', async () => {
    const r = await resolveDispute(
      mockCtx({ role: 'admin', listing: { ...disputedListing, status: 'active' } }).ctx,
      { itemType: 'listing', itemId: 'l1', decision: 'refund' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('server_error when no payment intent', async () => {
    const r = await resolveDispute(
      mockCtx({ role: 'admin', listing: { ...disputedListing, stripe_payment_intent_id: null } }).ctx,
      { itemType: 'listing', itemId: 'l1', decision: 'refund' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('server_error');
  });

  it('refund: cancels PI, reverts listing to active, clears buyer', async () => {
    const { ctx, updates } = mockCtx({ role: 'admin', listing: disputedListing });
    const r = await resolveDispute(ctx, {
      itemType: 'listing', itemId: 'l1', decision: 'refund', notes: 'broken',
    });
    expect(r.ok).toBe(true);
    expect(stripeCancel).toHaveBeenCalledWith('pi_x');
    const u = updates.find((x: any) => x.table === 'listings') as any;
    expect(u.row).toMatchObject({
      status: 'active', buyer_id: null,
      stripe_payment_intent_id: null, platform_fee_nok: null,
    });
    expect(u.row.dispute_resolution).toBe('broken');
  });

  it('release: captures PI, marks sold + delivered', async () => {
    const { ctx, updates } = mockCtx({ role: 'admin', listing: disputedListing });
    const r = await resolveDispute(ctx, {
      itemType: 'listing', itemId: 'l1', decision: 'release', notes: '',
    });
    expect(r.ok).toBe(true);
    expect(stripeCapture).toHaveBeenCalledWith('pi_x');
    const u = updates.find((x: any) => x.table === 'listings') as any;
    expect(u.row.status).toBe('sold');
    expect(u.row.dispute_resolution).toBe('Released by admin');
    expect(typeof u.row.sold_at).toBe('string');
    expect(typeof u.row.delivered_at).toBe('string');
  });

  it('writes a moderation_audit_log entry', async () => {
    const { ctx, inserts } = mockCtx({ role: 'admin', listing: disputedListing });
    await resolveDispute(ctx, {
      itemType: 'listing', itemId: 'l1', decision: 'refund', notes: 'damage',
    });
    const audit = inserts.find((x: any) => x.table === 'moderation_audit_log') as any;
    expect(audit?.row).toMatchObject({
      actor_id: 'admin-1',
      action: 'dispute_refund',
      target_type: 'listing',
      target_id: 'l1',
    });
  });
});

describe('resolveDispute — commission', () => {
  const disputedReq = {
    id: 'r1', buyer_id: 'b', title: 'Knit me a hat',
    status: 'disputed', awarded_offer_id: 'o1',
    stripe_payment_intent_id: 'pi_y',
  };

  it('not_found when request missing', async () => {
    const r = await resolveDispute(mockCtx({ role: 'admin' }).ctx, {
      itemType: 'commission', itemId: 'r1', decision: 'refund',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('conflict when not in disputed state', async () => {
    const r = await resolveDispute(
      mockCtx({ role: 'admin', request: { ...disputedReq, status: 'awarded' } }).ctx,
      { itemType: 'commission', itemId: 'r1', decision: 'refund' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('refund (new rail): plain refund from the platform balance, request cancelled', async () => {
    stripeRefundCreate.mockClear();
    stripeCancel.mockClear();
    const { ctx, updates } = mockCtx({
      role: 'admin', request: disputedReq, offer: { knitter_id: 'k1', price_nok: 500 },
    });
    const r = await resolveDispute(ctx, {
      itemType: 'commission', itemId: 'r1', decision: 'refund',
    });
    expect(r.ok).toBe(true);
    // Captured into the platform balance → refund, no cancel, NO reverse_transfer.
    expect(stripeRefundCreate).toHaveBeenCalledWith({ payment_intent: 'pi_y' });
    expect(stripeCancel).not.toHaveBeenCalled();
    const u = updates.find((x: any) => x.table === 'commission_requests') as any;
    expect(u.row.status).toBe('cancelled');
    expect(u.row.delivered_at).toBeUndefined();
  });

  it('refund (legacy uncaptured auth): cancels the PI instead', async () => {
    stripeCancel.mockClear();
    stripeRefundCreate.mockClear();
    stripeRetrieve.mockResolvedValueOnce({ status: 'requires_capture' });
    const { ctx, updates } = mockCtx({
      role: 'admin', request: disputedReq, offer: { knitter_id: 'k1', price_nok: 500 },
    });
    const r = await resolveDispute(ctx, {
      itemType: 'commission', itemId: 'r1', decision: 'refund',
    });
    expect(r.ok).toBe(true);
    expect(stripeCancel).toHaveBeenCalledWith('pi_y');
    expect(stripeRefundCreate).not.toHaveBeenCalled();
    const u = updates.find((x: any) => x.table === 'commission_requests') as any;
    expect(u.row.status).toBe('cancelled');
  });

  it('release: transfers the knitter share, sets request to delivered with delivered_at', async () => {
    stripeCapture.mockClear();
    stripeTransferCreate.mockClear();
    const { ctx, updates } = mockCtx({
      role: 'admin', request: disputedReq, offer: { knitter_id: 'k1', price_nok: 500 },
    });
    const r = await resolveDispute(ctx, {
      itemType: 'commission', itemId: 'r1', decision: 'release',
    });
    expect(r.ok).toBe(true);
    expect(stripeCapture).not.toHaveBeenCalled();
    expect(stripeTransferCreate).toHaveBeenCalledTimes(1);
    expect((stripeTransferCreate.mock.calls[0] as any)[0]).toMatchObject({ amount: 44000, destination: 'acct_k' });
    // releaseCommissionFunds records stripe_transfer_id first; the status
    // update is the one carrying `status`.
    const u = updates.find((x: any) => x.table === 'commission_requests' && (x.row as any).status) as any;
    expect(u.row.status).toBe('delivered');
    expect(typeof u.row.delivered_at).toBe('string');
  });

  it('handles request with no payment intent (no Stripe call)', async () => {
    stripeCancel.mockClear();
    const noPi = { ...disputedReq, stripe_payment_intent_id: null };
    const { ctx } = mockCtx({ role: 'admin', request: noPi, offer: { knitter_id: 'k1' } });
    const r = await resolveDispute(ctx, {
      itemType: 'commission', itemId: 'r1', decision: 'refund',
    });
    expect(r.ok).toBe(true);
    expect(stripeCancel).not.toHaveBeenCalled();
  });
});
