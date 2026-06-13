import { describe, it, expect, vi } from 'vitest';

// env statically imports cloudflare:workers (unavailable in the node test env),
// so mock it; mock the admin client to a controllable maybeSingle.
const { mockMaybeSingle } = vi.hoisted(() => ({ mockMaybeSingle: vi.fn() }));
vi.mock('../env', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'svc-key' } }));
vi.mock('../supabase', () => ({
  createAdminSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  }),
}));

import { getSellerConnectStatus } from './seller-status';

describe('getSellerConnectStatus', () => {
  it('returns the seller connect status enum (display gate for the buy CTA)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { stripe_connect_status: 'verified' } });
    expect(await getSellerConnectStatus('seller-1')).toBe('verified');
  });

  it('returns null when the seller has no seller_profiles row', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null });
    expect(await getSellerConnectStatus('seller-1')).toBeNull();
  });
});
