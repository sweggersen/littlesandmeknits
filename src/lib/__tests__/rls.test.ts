// RLS policy tests. Spins up Supabase clients as different users and
// asserts what they can and can't read across protected tables.
//
// Requires a running local Supabase (or any URL set on
// PUBLIC_SUPABASE_URL with a matching service-role key in
// SUPABASE_SERVICE_ROLE_KEY env var). Skipped if neither is available.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = (import.meta as any).env?.PUBLIC_SUPABASE_URL as string | undefined;
const ANON_KEY = (import.meta as any).env?.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
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
      const { data } = await admin.from('dead_letter_events').insert({
        service: 'rls.test',
        user_id: aliceId,
        error: 'fixture',
        context: {},
      }).select('id').single();
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
});
