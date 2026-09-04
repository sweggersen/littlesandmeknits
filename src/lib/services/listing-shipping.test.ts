import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServiceContext } from './types';

// Mock the seams: the real Bring API, the capture-at-ship money path, and the
// order lookup. We test the orchestration/guards, not those internals.
const bookShipment = vi.fn();
const bringAuthFromEnv = vi.fn();
vi.mock('../bring', () => ({
  bookShipment: (...a: unknown[]) => bookShipment(...a),
  bringAuthFromEnv: (...a: unknown[]) => bringAuthFromEnv(...a),
}));
const shipListing = vi.fn();
vi.mock('./listings-escrow', () => ({ shipListing: (...a: unknown[]) => shipListing(...a) }));
const findOpenOrder = vi.fn();
vi.mock('./orders', () => ({ findOpenOrder: (...a: unknown[]) => findOpenOrder(...a) }));

import { bookListingShipping } from './listing-shipping';

const SELLER = 'seller-1';
const ORDER = {
  id: 'o1', bring_shipment_number: null,
  shipping_name: 'Kari Kjøper', shipping_address: 'Storgata 1', shipping_postal_code: '0155', shipping_city: 'Oslo',
};
const SELLER_PROFILE = { legal_name: 'Ola Selger', address: 'Bakkeveien 2', postal_code: '5003', city: 'Bergen' };

// Minimal ctx: listings via supabase; seller_profiles + orders.update via admin.
function ctxWith(opts: { listing?: any; seller?: any } = {}): { ctx: ServiceContext; orderUpdates: any[] } {
  const listing = 'listing' in opts ? opts.listing : { id: 'l1', seller_id: SELLER, status: 'reserved' };
  const seller = 'seller' in opts ? opts.seller : SELLER_PROFILE;
  const orderUpdates: any[] = [];
  const table = (name: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: name === 'listings' ? listing : name === 'seller_profiles' ? seller : null }),
      }),
    }),
    update: (row: any) => ({ eq: async () => { orderUpdates.push({ table: name, row }); return {}; } }),
  });
  const client: any = { from: (n: string) => table(n) };
  return {
    ctx: { supabase: client, admin: client, user: { id: SELLER }, env: {} as any },
    orderUpdates,
  };
}

beforeEach(() => {
  bookShipment.mockReset();
  bringAuthFromEnv.mockReset().mockReturnValue({ uid: 'u', apiKey: 'k', customerNumber: 'c' });
  shipListing.mockReset().mockResolvedValue({ ok: true, data: { redirect: '/x' } });
  findOpenOrder.mockReset().mockResolvedValue({ ...ORDER });
});

describe('bookListingShipping', () => {
  it('503 when no carrier is configured (manual fallback)', async () => {
    bringAuthFromEnv.mockReturnValue(null);
    const { ctx } = ctxWith();
    const r = await bookListingShipping(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('service_unavailable');
    expect(bookShipment).not.toHaveBeenCalled();
  });

  it('not_found when the caller is not the seller', async () => {
    const { ctx } = ctxWith({ listing: { id: 'l1', seller_id: 'someone-else', status: 'reserved' } });
    const r = await bookListingShipping(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('conflict when the listing is not reserved', async () => {
    const { ctx } = ctxWith({ listing: { id: 'l1', seller_id: SELLER, status: 'active' } });
    const r = await bookListingShipping(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('conflict when a label was already generated', async () => {
    findOpenOrder.mockResolvedValue({ ...ORDER, bring_shipment_number: 'SN-EXISTING' });
    const { ctx } = ctxWith();
    const r = await bookListingShipping(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('conflict');
  });

  it('bad_input when the buyer shipping address is missing', async () => {
    findOpenOrder.mockResolvedValue({ ...ORDER, shipping_address: null });
    const { ctx } = ctxWith();
    const r = await bookListingShipping(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
  });

  it('bad_input when the seller has no return address', async () => {
    const { ctx } = ctxWith({ seller: { legal_name: 'X', address: null } });
    const r = await bookListingShipping(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
    expect(bookShipment).not.toHaveBeenCalled();
  });

  it('server_error when Bring booking fails', async () => {
    bookShipment.mockResolvedValue(null);
    const { ctx } = ctxWith();
    const r = await bookListingShipping(ctx, { listingId: 'l1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('server_error');
    expect(shipListing).not.toHaveBeenCalled();
  });

  it('happy path: books with buyer+seller addresses, stores label, ships, returns labelUrl', async () => {
    bookShipment.mockResolvedValue({ shipmentNumber: 'SN-123', labelFreeCode: 'https://label/abc' });
    const { ctx, orderUpdates } = ctxWith();
    const r = await bookListingShipping(ctx, { listingId: 'l1', weightGrams: 800 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.labelUrl).toBe('https://label/abc');

    // Booked with the right addresses + weight.
    expect(bookShipment).toHaveBeenCalledWith(
      { uid: 'u', apiKey: 'k', customerNumber: 'c' },
      expect.objectContaining({
        fromCity: 'Bergen', toCity: 'Oslo', toName: 'Kari Kjøper', toPostal: '0155', weightGrams: 800,
      }),
    );
    // Label + shipment number persisted on the order.
    const upd = orderUpdates.find((u) => u.table === 'orders');
    expect(upd.row).toMatchObject({ bring_shipment_number: 'SN-123', label_free_code: 'https://label/abc' });
    // Delegated to capture-at-ship with the real tracking number.
    expect(shipListing).toHaveBeenCalledWith(ctx, { listingId: 'l1', trackingCode: 'SN-123' });
  });
});
