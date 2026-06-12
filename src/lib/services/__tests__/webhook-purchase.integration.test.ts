// Highest-fidelity webhook test: a REAL Stripe-signed checkout.session.completed
// event, POSTed to the actual webhook handler, driving a real Postgres write.
//
// This covers the seam the unit tests can't: Stripe signature verification,
// event routing, and the glue that parses session fields into
// completeListingPurchase. Signature verification is HMAC-only (no network), so
// it runs fully offline — we sign with the same secret the handler verifies
// against.
//
// env is mocked to supply the Stripe keys; createAdminSupabase is overridden to
// point at local Postgres; Stripe itself is REAL (so the signature is really
// checked); notify is mocked to avoid email/push side effects.
//
// Requires local Supabase (PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
// Skipped otherwise — same convention as the other *.integration.test.ts files.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const { WH_SECRET } = vi.hoisted(() => ({ WH_SECRET: 'whsec_test_roundtrip' }));

vi.mock('../../../lib/env', () => ({
  env: {
    STRIPE_SECRET_KEY: 'sk_test_dummy',
    STRIPE_WEBHOOK_SECRET: WH_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY: '',
    VAPID_PRIVATE_KEY: '',
  },
}));

// Real Stripe; override only the admin-client factory to hit local Postgres.
vi.mock('../../../lib/supabase', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    createAdminSupabase: () =>
      createClient(process.env.PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string),
  };
});

vi.mock('../../../lib/notify', () => ({ createNotification: vi.fn() }));

const ENV: Record<string, string | undefined> =
  ((typeof process !== 'undefined' && process.env) || {}) as Record<string, string | undefined>;
const SUPABASE_URL = ENV.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;
const HAS_LOCAL = !!(SUPABASE_URL && SERVICE_KEY);

describe.skipIf(!HAS_LOCAL)('Stripe-signed webhook -> real Postgres', () => {
  let admin: SupabaseClient;
  let stripe: Stripe;
  let POST: (ctx: { request: Request }) => Promise<Response>;
  let createNotification: ReturnType<typeof vi.fn>;
  let sellerId: string;
  let buyerId: string;
  const createdListingIds: string[] = [];

  async function ensureUser(email: string): Promise<string> {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: 'wh-test-pwd' });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    return data.user.id;
  }

  async function seedActiveListing(): Promise<string> {
    const { data, error } = await admin.from('listings').insert({
      seller_id: sellerId, kind: 'ready_made', title: 'WEBHOOK TEST listing',
      price_nok: 500, size_label: 'One size', category: 'genser', status: 'active',
    }).select('id').single();
    if (error || !data) throw new Error(`seed failed: ${error?.message}`);
    createdListingIds.push(data.id);
    return data.id;
  }

  function signedRequest(body: object): Request {
    const payload = JSON.stringify(body);
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: WH_SECRET });
    return new Request('https://app.test/api/stripe/webhook', {
      method: 'POST',
      body: payload,
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
    });
  }

  function purchaseEvent(listingId: string, overrides: Record<string, unknown> = {}) {
    return {
      id: 'evt_test_1', object: 'event', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1', object: 'checkout.session',
          payment_intent: 'pi_roundtrip', amount_total: 56900,
          metadata: { type: 'listing_purchase', listing_id: listingId, buyer_id: buyerId },
          shipping_details: { name: 'Kari Nordmann', address: { line1: 'Storgata 1', postal_code: '0001', city: 'Oslo' } },
          ...overrides,
        },
      },
    };
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!);
    stripe = new Stripe('sk_test_dummy');
    POST = (await import('../../../pages/api/stripe/webhook')).POST as any;
    createNotification = (await import('../../../lib/notify')).createNotification as any;
    sellerId = await ensureUser('wh-seller@test.strikketorget.no');
    buyerId = await ensureUser('wh-buyer@test.strikketorget.no');
  }, 30_000);

  afterEach(async () => {
    vi.mocked(createNotification).mockClear();
    if (createdListingIds.length) {
      // Orders FK-restrict the listing delete — clear them first.
      await admin.from('orders').delete().in('listing_id', createdListingIds);
      await admin.from('listings').delete().in('id', createdListingIds);
      createdListingIds.length = 0;
    }
    // The webhook now records processed event ids in stripe_webhook_events for
    // idempotency (june26 §1.2). That ledger persists in real Postgres, so a
    // fixed test event id would be skipped as "already processed" on the next
    // test/run. Clear the test events so each case starts fresh.
    await admin.from('stripe_webhook_events').delete().eq('event_id', 'evt_test_1');
  });

  it('rejects a bad signature with 400', async () => {
    const listingId = await seedActiveListing();
    const payload = JSON.stringify(purchaseEvent(listingId));
    const req = new Request('https://app.test/api/stripe/webhook', {
      method: 'POST', body: payload, headers: { 'stripe-signature': 't=1,v1=deadbeef' },
    });
    const res = await POST({ request: req });
    expect(res.status).toBe(400);
    // Untouched.
    const { data } = await admin.from('listings').select('status').eq('id', listingId).single();
    expect(data?.status).toBe('active');
  });

  it('a valid signed purchase event transitions the listing and notifies the seller', async () => {
    const listingId = await seedActiveListing();
    const res = await POST({ request: signedRequest(purchaseEvent(listingId)) });
    expect(res.status).toBe(200);

    const { data: lrow } = await admin
      .from('listings').select('status, buyer_id').eq('id', listingId).single();
    expect(lrow).toMatchObject({ status: 'reserved', buyer_id: buyerId });
    // The signed event's money + PII landed on the order.
    const { data: order } = await admin
      .from('orders')
      .select('status, buyer_id, stripe_payment_intent_id, platform_fee_nok, shipping_name, shipping_city')
      .eq('listing_id', listingId).single();
    expect(order).toMatchObject({
      status: 'reserved', buyer_id: buyerId, stripe_payment_intent_id: 'pi_roundtrip',
      platform_fee_nok: 74, shipping_name: 'Kari Nordmann', shipping_city: 'Oslo',
    });

    expect(createNotification).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(createNotification).mock.calls[0];
    expect(payload).toMatchObject({
      userId: sellerId, type: 'listing_purchased', title: 'Varen din er solgt!',
      url: `/market/listing/${listingId}`, actorId: buyerId,
    });
  });

  it('a duplicate delivery (Stripe retry) does not re-notify', async () => {
    const listingId = await seedActiveListing();
    const first = await POST({ request: signedRequest(purchaseEvent(listingId)) });
    expect(first.status).toBe(200);
    expect(createNotification).toHaveBeenCalledTimes(1);

    vi.mocked(createNotification).mockClear();
    const second = await POST({ request: signedRequest(purchaseEvent(listingId)) });
    expect(second.status).toBe(200); // still ack the retry
    expect(createNotification).not.toHaveBeenCalled(); // but no duplicate "sold" notification
  });
});
