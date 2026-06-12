// Integration test: the listing-purchase escrow transition against REAL
// Postgres (local Supabase). Unlike the fake-db unit tests, this exercises
// actual column constraints (the 0045 shipping columns must exist), the
// listing_status enum, the active-status guard, and the real PostgREST update
// path the Stripe webhook drives.
//
// Requires a running local Supabase: PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// (+ PUBLIC_SUPABASE_ANON_KEY). Skipped otherwise — same convention as rls.test.ts.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { completeListingPurchase } from '../listings';

const ENV: Record<string, string | undefined> =
  ((typeof process !== 'undefined' && process.env) || {}) as Record<string, string | undefined>;
const SUPABASE_URL = ENV.PUBLIC_SUPABASE_URL ?? (import.meta as any).env?.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = (() => {
  try { return (process as any)?.env?.SUPABASE_SERVICE_ROLE_KEY as string | undefined; } catch { return undefined; }
})();
const HAS_LOCAL = !!(SUPABASE_URL && SERVICE_KEY);

describe.skipIf(!HAS_LOCAL)('completeListingPurchase against real Postgres', () => {
  let admin: SupabaseClient;
  let sellerId: string;
  let buyerId: string;
  const createdListingIds: string[] = [];

  async function ensureUser(email: string): Promise<string> {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await admin.auth.admin.createUser({
      email, email_confirm: true, password: 'purchase-test-pwd',
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    return data.user.id;
  }

  async function seedActiveListing(): Promise<string> {
    const { data, error } = await admin
      .from('listings')
      .insert({
        seller_id: sellerId,
        kind: 'ready_made',
        title: 'INTEGRATION TEST listing',
        price_nok: 500,
        size_label: 'One size',
        category: 'genser',
        status: 'active',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seed listing failed: ${error?.message}`);
    createdListingIds.push(data.id);
    return data.id;
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!);
    sellerId = await ensureUser('purchase-seller@test.strikketorget.no');
    buyerId = await ensureUser('purchase-buyer@test.strikketorget.no');
  }, 30_000);

  afterEach(async () => {
    if (createdListingIds.length) {
      // Orders FK-restrict the listing delete — clear them first.
      await admin.from('orders').delete().in('listing_id', createdListingIds);
      await admin.from('listings').delete().in('id', createdListingIds);
      createdListingIds.length = 0;
    }
  });

  it('moves an active listing to reserved and persists buyer + shipping + fee', async () => {
    const listingId = await seedActiveListing();
    const res = await completeListingPurchase(admin as any, {
      listingId,
      buyerId,
      paymentIntentId: 'pi_integration_test',
      amountTotalOre: 56900,
      shipping: { name: 'Kari Nordmann', line1: 'Storgata 1', postalCode: '0001', city: 'Oslo' },
    });

    expect(res.updated).toBe(true);
    expect(res.listing?.seller_id).toBe(sellerId);

    // Catalog row carries only the projection.
    const { data: lrow } = await admin
      .from('listings').select('status, buyer_id').eq('id', listingId).single();
    expect(lrow).toMatchObject({ status: 'reserved', buyer_id: buyerId });

    // The order (real Postgres) holds the money + PII + lifecycle.
    const { data: order } = await admin
      .from('orders')
      .select('status, buyer_id, stripe_payment_intent_id, platform_fee_nok, reserved_at, ship_deadline_at, shipping_name, shipping_address, shipping_postal_code, shipping_city')
      .eq('listing_id', listingId)
      .single();
    expect(order).toMatchObject({
      status: 'reserved',
      buyer_id: buyerId,
      stripe_payment_intent_id: 'pi_integration_test',
      platform_fee_nok: 74, // round(56900 * 0.13 / 100)
      shipping_name: 'Kari Nordmann',
      shipping_address: 'Storgata 1',
      shipping_postal_code: '0001',
      shipping_city: 'Oslo',
    });
    expect(order?.reserved_at).toBeTruthy();
    expect(order?.ship_deadline_at).toBeTruthy();
  });

  it('is idempotent: a second delivery leaves the row reserved and reports no transition', async () => {
    const listingId = await seedActiveListing();
    const first = await completeListingPurchase(admin as any, {
      listingId, buyerId, paymentIntentId: 'pi_1', amountTotalOre: 50000,
    });
    expect(first.updated).toBe(true);

    const second = await completeListingPurchase(admin as any, {
      listingId, buyerId: 'someone-else', paymentIntentId: 'pi_2', amountTotalOre: 99999,
    });
    expect(second.updated).toBe(false);
    expect(second.listing).toBeNull();

    // The first buyer + PI stand; the retry created no second open order.
    const { data: lrow } = await admin.from('listings').select('buyer_id').eq('id', listingId).single();
    expect(lrow?.buyer_id).toBe(buyerId);
    const { data: orders } = await admin
      .from('orders').select('stripe_payment_intent_id').eq('listing_id', listingId);
    expect(orders).toHaveLength(1);
    expect(orders![0].stripe_payment_intent_id).toBe('pi_1');
  });

  it('does not transition a listing that is not active', async () => {
    const listingId = await seedActiveListing();
    await admin.from('listings').update({ status: 'draft' }).eq('id', listingId);

    const res = await completeListingPurchase(admin as any, {
      listingId, buyerId, paymentIntentId: 'pi_x', amountTotalOre: 10000,
    });
    expect(res.updated).toBe(false);

    const { data: row } = await admin.from('listings').select('status, buyer_id').eq('id', listingId).single();
    expect(row).toMatchObject({ status: 'draft', buyer_id: null });
  });
});
