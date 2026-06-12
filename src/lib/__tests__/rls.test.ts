// RLS policy tests. Spins up Supabase clients as different users and
// asserts what they can and can't read across protected tables.
//
// Requires a running local Supabase (or any URL set on
// PUBLIC_SUPABASE_URL with a matching service-role key in
// SUPABASE_SERVICE_ROLE_KEY env var). Skipped if neither is available.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Vitest doesn't auto-expose PUBLIC_* env vars on import.meta.env
// (that's an Astro/Vite-config thing). Read process.env first; fall
// back to import.meta.env so the file works in both contexts.
const ENV: Record<string, string | undefined> = ((typeof process !== 'undefined' && process.env) || {}) as Record<string, string | undefined>;
const SUPABASE_URL = ENV.PUBLIC_SUPABASE_URL ?? (import.meta as any).env?.PUBLIC_SUPABASE_URL as string | undefined;
const ANON_KEY = ENV.PUBLIC_SUPABASE_ANON_KEY ?? (import.meta as any).env?.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
const SERVICE_KEY = (() => {
  try {
    return (process as any)?.env?.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
  } catch {
    return undefined;
  }
})();

const HAS_LOCAL = !!(SUPABASE_URL && ANON_KEY && SERVICE_KEY);

describe.skipIf(!HAS_LOCAL)('RLS policies', () => {
  let admin: SupabaseClient;
  let aliceId: string;  // buyer
  let bobId: string;    // seller / knitter
  let charlieId: string; // third party
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let charlieClient: SupabaseClient;

  async function ensureUser(email: string): Promise<string> {
    // Idempotent: returns existing user id if email already exists.
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await admin.auth.admin.createUser({
      email, email_confirm: true, password: 'rls-test-pwd',
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    return data.user.id;
  }

  async function userClient(email: string): Promise<SupabaseClient> {
    const c = createClient(SUPABASE_URL!, ANON_KEY!);
    const { error } = await c.auth.signInWithPassword({ email, password: 'rls-test-pwd' });
    if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
    return c;
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!);

    aliceId = await ensureUser('rls-alice@test.strikketorget.no');
    bobId = await ensureUser('rls-bob@test.strikketorget.no');
    charlieId = await ensureUser('rls-charlie@test.strikketorget.no');

    aliceClient = await userClient('rls-alice@test.strikketorget.no');
    bobClient = await userClient('rls-bob@test.strikketorget.no');
    charlieClient = await userClient('rls-charlie@test.strikketorget.no');
  }, 30_000);

  describe('profiles', () => {
    it('owner can read their own profile', async () => {
      const { data, error } = await aliceClient.from('profiles').select('id').eq('id', aliceId).maybeSingle();
      expect(error).toBeNull();
      expect(data?.id).toBe(aliceId);
    });

    it('anyone can read any visible profile (display table is public-ish)', async () => {
      // profiles table has public read by default per the project's policies;
      // this test pins that behaviour so an accidental tightening surfaces.
      const { data } = await charlieClient.from('profiles').select('id').eq('id', aliceId).maybeSingle();
      expect(data?.id).toBe(aliceId);
    });
  });

  describe('dead_letter_events', () => {
    let eventId: string;

    beforeAll(async () => {
      const { data, error } = await admin.from('dead_letter_events').insert({
        service: 'rls.test',
        user_id: aliceId,
        error: 'fixture',
        context: {},
      }).select('id').single();
      if (error) throw new Error(`dead_letter_events setup insert failed: ${error.message} | code=${error.code} | details=${error.details} | hint=${error.hint}`);
      eventId = data!.id;
    });

    it('non-staff cannot read dead-letter events', async () => {
      const { data, error } = await charlieClient
        .from('dead_letter_events').select('id').eq('id', eventId);
      // RLS returns empty rather than an error for SELECT.
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it('staff can read dead-letter events', async () => {
      await admin.from('profiles').update({ role: 'admin' }).eq('id', bobId);
      const staff = await userClient('rls-bob@test.strikketorget.no');
      const { data } = await staff.from('dead_letter_events').select('id').eq('id', eventId);
      expect(data ?? []).not.toHaveLength(0);
      await admin.from('profiles').update({ role: null }).eq('id', bobId);  // restore
    });
  });

  describe('listings', () => {
    it('active listing is readable by any signed-in user', async () => {
      const { data: listing, error } = await admin.from('listings').insert({
        seller_id: bobId,
        title: 'rls-active', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0,
        status: 'active',
      }).select('id').single();
      if (error) throw new Error(`insert failed: ${error.message}`);
      const { data } = await charlieClient.from('listings').select('id').eq('id', listing!.id);
      expect(data ?? []).toHaveLength(1);
      await admin.from('listings').delete().eq('id', listing!.id);
    });

    it('draft listing is NOT readable by a third party', async () => {
      const { data: listing, error } = await admin.from('listings').insert({
        seller_id: bobId,
        title: 'rls-draft', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0,
        status: 'draft',
      }).select('id').single();
      if (error) throw new Error(`insert failed: ${error.message}`);
      const { data: third } = await charlieClient.from('listings').select('id').eq('id', listing!.id);
      expect(third ?? []).toHaveLength(0);
      const { data: own } = await bobClient.from('listings').select('id').eq('id', listing!.id);
      expect(own ?? []).toHaveLength(1);
      await admin.from('listings').delete().eq('id', listing!.id);
    });

    it('buyer can read their own reserved listing (purchase-flow policy)', async () => {
      const { data: listing, error } = await admin.from('listings').insert({
        seller_id: bobId,
        title: 'rls-reserved', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0,
        status: 'reserved',
        buyer_id: aliceId,
      }).select('id').single();
      if (error) throw new Error(`insert failed: ${error.message}`);
      const { data: buyer } = await aliceClient.from('listings').select('id').eq('id', listing!.id);
      expect(buyer ?? []).toHaveLength(1);
      const { data: third } = await charlieClient.from('listings').select('id').eq('id', listing!.id);
      expect(third ?? []).toHaveLength(0);
      await admin.from('listings').delete().eq('id', listing!.id);
    });
  });

  describe('marketplace conversations + messages', () => {
    let listingId: string;
    let convId: string;

    beforeAll(async () => {
      const { data: l, error } = await admin.from('listings').insert({
        seller_id: bobId,
        title: 'rls-msg-listing', description: 'x',
        price_nok: 100, kind: 'ready_made', category: 'genser',
        size_label: 'M', shipping_price_nok: 0,
        status: 'active',
      }).select('id').single();
      if (error) throw new Error(`msg-listing insert failed: ${error.message}`);
      listingId = l!.id;
      const { data: c } = await admin.from('marketplace_conversations').insert({
        listing_id: listingId, buyer_id: aliceId, seller_id: bobId,
      }).select('id').single();
      convId = c!.id;
      await admin.from('marketplace_messages').insert({
        conversation_id: convId, sender_id: aliceId, body: 'rls hello',
      });
    });

    it('participants see the conversation; third party does not', async () => {
      const { data: a } = await aliceClient.from('marketplace_conversations')
        .select('id').eq('id', convId);
      expect(a ?? []).toHaveLength(1);
      const { data: b } = await bobClient.from('marketplace_conversations')
        .select('id').eq('id', convId);
      expect(b ?? []).toHaveLength(1);
      const { data: c } = await charlieClient.from('marketplace_conversations')
        .select('id').eq('id', convId);
      expect(c ?? []).toHaveLength(0);
    });

    it('participants see messages; third party does not', async () => {
      const { data: a } = await aliceClient.from('marketplace_messages')
        .select('id, body').eq('conversation_id', convId);
      expect((a ?? []).length).toBeGreaterThan(0);
      const { data: c } = await charlieClient.from('marketplace_messages')
        .select('id, body').eq('conversation_id', convId);
      expect(c ?? []).toHaveLength(0);
    });

    it('third party cannot send a message into someone else conversation', async () => {
      const { error } = await charlieClient.from('marketplace_messages').insert({
        conversation_id: convId, sender_id: charlieId, body: 'intruder',
      });
      // RLS WITH CHECK violation surfaces as a row-level security error.
      expect(error).not.toBeNull();
    });
  });

  describe('commission_requests', () => {
    it('open public requests are readable by any signed-in user; private targeted ones are hidden', async () => {
      const { data: openReq, error: openErr } = await admin.from('commission_requests').insert({
        buyer_id: aliceId,
        title: 'rls open',
        category: 'genser', size_label: 'M',
        budget_nok_min: 100, budget_nok_max: 200,
        status: 'open',
      }).select('id').single();
      if (openErr) throw new Error(`open insert failed: ${openErr.message}`);
      const { data: privateReq, error: privErr } = await admin.from('commission_requests').insert({
        buyer_id: aliceId,
        title: 'rls private',
        category: 'genser', size_label: 'M',
        budget_nok_min: 100, budget_nok_max: 200,
        status: 'open',
        target_knitter_id: bobId,
      }).select('id').single();
      if (privErr) throw new Error(`private insert failed: ${privErr.message}`);

      // Third party (charlie): sees only the public open one
      const { data: charlieOpen } = await charlieClient.from('commission_requests')
        .select('id').eq('id', openReq!.id);
      expect(charlieOpen ?? []).toHaveLength(1);
      const { data: charliePrivate } = await charlieClient.from('commission_requests')
        .select('id').eq('id', privateReq!.id);
      expect(charliePrivate ?? []).toHaveLength(0);

      // Targeted knitter (bob): sees the private one
      const { data: bobPrivate } = await bobClient.from('commission_requests')
        .select('id').eq('id', privateReq!.id);
      expect(bobPrivate ?? []).toHaveLength(1);

      await admin.from('commission_requests').delete().in('id', [openReq!.id, privateReq!.id]);
    });

    it('frozen requests are hidden from non-owners', async () => {
      const { data: req } = await admin.from('commission_requests').insert({
        buyer_id: aliceId,
        title: 'rls frozen',
        category: 'genser', size_label: 'M',
        budget_nok_min: 100, budget_nok_max: 200,
        status: 'frozen',
      }).select('id').single();

      const { data: charlieReads } = await charlieClient.from('commission_requests')
        .select('id').eq('id', req!.id);
      expect(charlieReads ?? []).toHaveLength(0);

      // Owner (alice) still sees their own
      const { data: aliceReads } = await aliceClient.from('commission_requests')
        .select('id').eq('id', req!.id);
      expect(aliceReads ?? []).toHaveLength(1);

      await admin.from('commission_requests').delete().eq('id', req!.id);
    });
  });

  describe('commission_offers', () => {
    it('only the offering knitter and the request buyer can read the offer', async () => {
      const { data: req } = await admin.from('commission_requests').insert({
        buyer_id: aliceId,
        title: 'rls offer-req',
        category: 'genser', size_label: 'M',
        budget_nok_min: 100, budget_nok_max: 200,
        status: 'open',
      }).select('id').single();
      const { data: offer } = await admin.from('commission_offers').insert({
        request_id: req!.id, knitter_id: bobId,
        price_nok: 150, turnaround_weeks: 2, message: 'rls',
        status: 'pending',
      }).select('id').single();

      const { data: bobReads } = await bobClient.from('commission_offers')
        .select('id').eq('id', offer!.id);
      expect(bobReads ?? []).toHaveLength(1);

      const { data: aliceReads } = await aliceClient.from('commission_offers')
        .select('id').eq('id', offer!.id);
      expect(aliceReads ?? []).toHaveLength(1);

      const { data: charlieReads } = await charlieClient.from('commission_offers')
        .select('id').eq('id', offer!.id);
      expect(charlieReads ?? []).toHaveLength(0);

      await admin.from('commission_offers').delete().eq('id', offer!.id);
      await admin.from('commission_requests').delete().eq('id', req!.id);
    });
  });

  describe('projects (commission buyer access via 0070 policy)', () => {
    it('buyer of a commission can read the linked project; third party cannot', async () => {
      // Set up: Bob (knitter) creates an offer accepted by Alice (buyer);
      // a project is linked to the offer. Charlie is unrelated.
      const { data: req } = await admin.from('commission_requests').insert({
        buyer_id: aliceId,
        title: 'RLS test commission',
        category: 'genser',
        size_label: 'M',
        budget_nok_min: 100, budget_nok_max: 200,
        status: 'open',
      }).select('id').single();
      const { data: offer } = await admin.from('commission_offers').insert({
        request_id: req!.id, knitter_id: bobId,
        price_nok: 150, turnaround_weeks: 2,
        message: 'rls',
        status: 'accepted',
      }).select('id').single();
      await admin.from('commission_requests').update({
        awarded_offer_id: offer!.id, status: 'awaiting_payment',
      }).eq('id', req!.id);
      const { data: project } = await admin.from('projects').insert({
        user_id: bobId, title: 'rls project',
        status: 'planning', commission_offer_id: offer!.id,
      }).select('id').single();

      // Alice (buyer) reads via the 0070 policy
      const { data: aliceReads } = await aliceClient.from('projects')
        .select('id').eq('id', project!.id);
      expect(aliceReads ?? []).toHaveLength(1);

      // Bob (owner/knitter) reads via the owner policy
      const { data: bobReads } = await bobClient.from('projects')
        .select('id').eq('id', project!.id);
      expect(bobReads ?? []).toHaveLength(1);

      // Charlie sees nothing
      const { data: charlieReads } = await charlieClient.from('projects')
        .select('id').eq('id', project!.id);
      expect(charlieReads ?? []).toHaveLength(0);

      // Cleanup so re-runs are idempotent
      await admin.from('projects').delete().eq('id', project!.id);
      await admin.from('commission_offers').delete().eq('id', offer!.id);
      await admin.from('commission_requests').delete().eq('id', req!.id);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Profile-split tables (migration 0072). These hold PII —
  // kontonummer, address, phone, OIDC sub — so the RLS posture is
  // owner-only + staff-for-moderation. The tests pin the boundary.
  // ──────────────────────────────────────────────────────────────

  describe('seller_profiles', () => {
    beforeAll(async () => {
      // Alice seeds a seller_profile for these tests.
      const { error } = await admin.from('seller_profiles').upsert({
        id: aliceId,
        legal_name: 'Alice Test',
        kontonummer: '12345678901',
        stripe_connect_status: 'pending',
      });
      if (error) throw new Error(`seller_profiles setup upsert failed: ${error.message} | code=${error.code} | details=${error.details} | hint=${error.hint}`);
    });

    it('owner reads own seller_profile', async () => {
      const { data } = await aliceClient.from('seller_profiles')
        .select('id, legal_name, kontonummer').eq('id', aliceId).maybeSingle();
      expect(data?.id).toBe(aliceId);
      expect(data?.kontonummer).toBe('12345678901');
    });

    it('third party CANNOT read another user\'s seller_profile', async () => {
      const { data } = await charlieClient.from('seller_profiles')
        .select('id, kontonummer').eq('id', aliceId);
      expect(data ?? []).toHaveLength(0);
    });

    it('staff (admin role) reads any seller_profile', async () => {
      await admin.from('profiles').update({ role: 'admin' }).eq('id', bobId);
      const staff = await userClient('rls-bob@test.strikketorget.no');
      const { data } = await staff.from('seller_profiles')
        .select('id, kontonummer').eq('id', aliceId);
      expect(data ?? []).not.toHaveLength(0);
      await admin.from('profiles').update({ role: null }).eq('id', bobId);
    });

    afterAll(async () => {
      await admin.from('seller_profiles').delete().eq('id', aliceId);
    });
  });

  describe('buyer_preferences', () => {
    beforeAll(async () => {
      const { error } = await admin.from('buyer_preferences').upsert({
        id: aliceId,
        marketplace_interests: ['children'],
        strikketorget_welcomed_at: new Date().toISOString(),
      });
      if (error) throw new Error(`buyer_preferences setup upsert failed: ${error.message} | code=${error.code} | details=${error.details} | hint=${error.hint}`);
    });

    it('owner reads own buyer_preferences', async () => {
      const { data } = await aliceClient.from('buyer_preferences')
        .select('id, marketplace_interests').eq('id', aliceId).maybeSingle();
      expect(data?.id).toBe(aliceId);
      expect(data?.marketplace_interests).toEqual(['children']);
    });

    it('third party CANNOT read another user\'s buyer_preferences', async () => {
      const { data } = await charlieClient.from('buyer_preferences')
        .select('id').eq('id', aliceId);
      expect(data ?? []).toHaveLength(0);
    });

    afterAll(async () => {
      await admin.from('buyer_preferences').delete().eq('id', aliceId);
    });
  });

  describe('auth_identities', () => {
    let identityId: string;

    beforeAll(async () => {
      const { data, error } = await admin.from('auth_identities').insert({
        user_id: aliceId,
        provider: 'vipps',
        sub: 'rls-test-sub-' + aliceId.slice(0, 8),
        phone: '+4712345678',
      }).select('id').single();
      if (error) throw new Error(`auth_identities setup insert failed: ${error.message} | code=${error.code} | details=${error.details} | hint=${error.hint}`);
      identityId = data!.id;
    });

    it('owner reads own auth_identities', async () => {
      const { data } = await aliceClient.from('auth_identities')
        .select('id, provider, sub').eq('user_id', aliceId);
      expect(data ?? []).not.toHaveLength(0);
      expect(data?.[0].provider).toBe('vipps');
    });

    it('third party CANNOT read another user\'s auth_identities', async () => {
      const { data } = await charlieClient.from('auth_identities')
        .select('id').eq('user_id', aliceId);
      expect(data ?? []).toHaveLength(0);
    });

    it('staff (admin role) reads any auth_identity (moderation needs it)', async () => {
      await admin.from('profiles').update({ role: 'admin' }).eq('id', bobId);
      const staff = await userClient('rls-bob@test.strikketorget.no');
      const { data } = await staff.from('auth_identities')
        .select('id, sub, phone').eq('user_id', aliceId);
      expect(data ?? []).not.toHaveLength(0);
      await admin.from('profiles').update({ role: null }).eq('id', bobId);
    });

    it('unique(provider, sub) blocks two users claiming the same OIDC subject', async () => {
      // Bob tries to claim Alice's vipps sub.
      const { error } = await admin.from('auth_identities').insert({
        user_id: bobId,
        provider: 'vipps',
        sub: 'rls-test-sub-' + aliceId.slice(0, 8),
        phone: '+4787654321',
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('23505'); // unique_violation
    });

    afterAll(async () => {
      await admin.from('auth_identities').delete().eq('id', identityId);
    });
  });
});
