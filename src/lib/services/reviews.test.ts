import { describe, it, expect, vi } from 'vitest';
import { submitReview } from './reviews';
import type { ServiceContext } from './types';

vi.mock('../notify', () => ({ createNotification: vi.fn() }));
vi.mock('../trust', () => ({ recalculateTrust: vi.fn() }));

interface MockOpts {
  request?: { id: string; buyer_id: string; status: string } | null;
  acceptedOffer?: { knitter_id: string } | null;
  existingCount?: number;
}

function mockCtx(opts: MockOpts = {}) {
  const inserts: unknown[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: (col1: string, val1: unknown) => ({
          eq: (col2: string, val2: unknown) => ({
            maybeSingle: async () => {
              if (table === 'commission_offers' && val2 === 'accepted') {
                return { data: opts.acceptedOffer ?? null };
              }
              return { data: null };
            },
            // .from('transaction_reviews').select(...,{head:true}).eq().eq()
            // returns { count } when awaited; not exercised by these tests.
          }),
          maybeSingle: async () => {
            if (table === 'commission_requests') return { data: opts.request ?? null };
            return { data: null };
          },
        }),
      }),
      insert: async (row: unknown) => {
        inserts.push({ table, row });
        return { error: null };
      },
    }),
  };
  // The transaction_reviews "already_reviewed" count call:
  // .from('transaction_reviews').select(_, { count: 'exact', head: true }).eq().eq() returns { count }
  // Above mock collapses .eq().eq() into a then-able. Awaiting it returns { count }.
  const ctx: ServiceContext = {
    supabase: client as any,
    admin: client as any,
    user: { id: 'u-buyer', email: 'b@x.io' },
    env: {},
  };
  return { ctx, inserts };
}

const VALID_REQ_ID = '11111111-2222-3333-4444-555555555555';

describe('submitReview — input validation', () => {
  it('rejects missing fields', async () => {
    const r = await submitReview(mockCtx().ctx, { commissionRequestId: '', rating: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects rating < 1', async () => {
    const r = await submitReview(mockCtx().ctx, { commissionRequestId: VALID_REQ_ID, rating: 0 });
    expect(r.ok).toBe(false);
  });

  it('rejects rating > 5', async () => {
    const r = await submitReview(mockCtx().ctx, { commissionRequestId: VALID_REQ_ID, rating: 6 });
    expect(r.ok).toBe(false);
  });
});

describe('submitReview — eligibility', () => {
  it('rejects non-delivered commissions', async () => {
    const { ctx } = mockCtx({
      request: { id: VALID_REQ_ID, buyer_id: 'u-buyer', status: 'awarded' },
    });
    const r = await submitReview(ctx, { commissionRequestId: VALID_REQ_ID, rating: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('rejects when commission has no accepted offer', async () => {
    const { ctx } = mockCtx({
      request: { id: VALID_REQ_ID, buyer_id: 'u-buyer', status: 'delivered' },
      acceptedOffer: null,
    });
    const r = await submitReview(ctx, { commissionRequestId: VALID_REQ_ID, rating: 5 });
    expect(r.ok).toBe(false);
  });

  it('forbids reviewers who are neither buyer nor knitter', async () => {
    const { ctx } = mockCtx({
      request: { id: VALID_REQ_ID, buyer_id: 'someone-else', status: 'delivered' },
      acceptedOffer: { knitter_id: 'k-1' },
    });
    const r = await submitReview(ctx, { commissionRequestId: VALID_REQ_ID, rating: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });
});
