import { describe, it, expect } from 'vitest';
import {
  computeBuyerDisputeHistory,
  REPEAT_CLAIMER_MIN_CLAIMS,
  type BuyerHistoryOrder,
  type BuyerHistoryCommission,
} from './buyer-history';

const order = (o: Partial<BuyerHistoryOrder> = {}): BuyerHistoryOrder => ({
  refund_requested_at: null,
  disputed_at: null,
  refund_outcome: null,
  cancel_reason: null,
  ...o,
});
const commission = (c: Partial<BuyerHistoryCommission> = {}): BuyerHistoryCommission => ({
  status: 'delivered',
  disputed_at: null,
  ...c,
});

describe('computeBuyerDisputeHistory', () => {
  it('returns all-zero for a buyer with no history', () => {
    const h = computeBuyerDisputeHistory({ orders: [], commissions: [] });
    expect(h).toEqual({
      purchases: 0,
      claims: 0,
      upheldClaims: 0,
      claimRate: 0,
      repeatClaimer: false,
    });
  });

  it('counts orders and commissions as purchases', () => {
    const h = computeBuyerDisputeHistory({
      orders: [order(), order()],
      commissions: [commission()],
    });
    expect(h.purchases).toBe(3);
    expect(h.claims).toBe(0);
    expect(h.claimRate).toBe(0);
  });

  it('counts a refund request as one claim', () => {
    const h = computeBuyerDisputeHistory({
      orders: [order({ refund_requested_at: '2026-01-01' }), order()],
      commissions: [],
    });
    expect(h.claims).toBe(1);
    expect(h.claimRate).toBe(0.5);
  });

  it('does not double-count an order that had both a refund request and a dispute', () => {
    const h = computeBuyerDisputeHistory({
      orders: [order({ refund_requested_at: '2026-01-01', disputed_at: '2026-01-05' })],
      commissions: [],
    });
    expect(h.purchases).toBe(1);
    expect(h.claims).toBe(1);
  });

  it('counts commission disputes as claims', () => {
    const h = computeBuyerDisputeHistory({
      orders: [],
      commissions: [commission({ disputed_at: '2026-01-01' }), commission()],
    });
    expect(h.claims).toBe(1);
    expect(h.purchases).toBe(2);
  });

  it('tallies upheld claims from refund_outcome and cancel_reason', () => {
    const h = computeBuyerDisputeHistory({
      orders: [
        order({ refund_requested_at: '2026-01-01', refund_outcome: 'accepted' }),
        order({ disputed_at: '2026-01-01', cancel_reason: 'admin_refund' }),
        order({ refund_requested_at: '2026-01-01', refund_outcome: 'declined' }),
      ],
      commissions: [],
    });
    expect(h.claims).toBe(3);
    expect(h.upheldClaims).toBe(2);
  });

  it('does NOT count commission claims toward upheldClaims (conservative)', () => {
    const h = computeBuyerDisputeHistory({
      orders: [],
      commissions: [commission({ disputed_at: '2026-01-01' })],
    });
    expect(h.claims).toBe(1);
    expect(h.upheldClaims).toBe(0);
  });

  it('flags a repeat claimer: >=3 claims and rate >=0.5', () => {
    const orders = [
      order({ refund_requested_at: '2026-01-01' }),
      order({ disputed_at: '2026-01-02' }),
      order({ refund_requested_at: '2026-01-03' }),
      order(), // one clean purchase → 3/4 = 0.75
    ];
    const h = computeBuyerDisputeHistory({ orders, commissions: [] });
    expect(h.claims).toBe(REPEAT_CLAIMER_MIN_CLAIMS);
    expect(h.claimRate).toBe(0.75);
    expect(h.repeatClaimer).toBe(true);
  });

  it('does not flag when claims are high but rate is low (many clean purchases)', () => {
    const orders = [
      order({ refund_requested_at: '2026-01-01' }),
      order({ disputed_at: '2026-01-02' }),
      order({ refund_requested_at: '2026-01-03' }),
      ...Array.from({ length: 7 }, () => order()), // 3/10 = 0.30
    ];
    const h = computeBuyerDisputeHistory({ orders, commissions: [] });
    expect(h.claims).toBe(3);
    expect(h.claimRate).toBe(0.3);
    expect(h.repeatClaimer).toBe(false);
  });

  it('does not flag with a high rate but fewer than 3 claims', () => {
    const h = computeBuyerDisputeHistory({
      orders: [order({ disputed_at: '2026-01-01' }), order({ refund_requested_at: '2026-01-02' })],
      commissions: [],
    });
    expect(h.claims).toBe(2);
    expect(h.claimRate).toBe(1);
    expect(h.repeatClaimer).toBe(false);
  });

  it('rounds claimRate to two decimals', () => {
    const orders = [
      order({ disputed_at: '2026-01-01' }),
      order(),
      order(), // 1/3 = 0.333...
    ];
    const h = computeBuyerDisputeHistory({ orders, commissions: [] });
    expect(h.claimRate).toBe(0.33);
  });
});
