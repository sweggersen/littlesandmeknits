// Guards the paid-content storage config against a fresh/misconfigured env
// shipping the `patterns` bucket public (leaking paid PDFs). Runs against a real
// local Supabase; skipped cleanly when it's down. See migration 0111.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const ENV: Record<string, string | undefined> = ((typeof process !== 'undefined' && process.env) || {}) as Record<string, string | undefined>;
const SUPABASE_URL = ENV.PUBLIC_SUPABASE_URL ?? (import.meta as any).env?.PUBLIC_SUPABASE_URL;
const ANON_KEY = ENV.PUBLIC_SUPABASE_ANON_KEY ?? (import.meta as any).env?.PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = (() => { try { return (process as any)?.env?.SUPABASE_SERVICE_ROLE_KEY; } catch { return undefined; } })();
const HAS_LOCAL = !!(SUPABASE_URL && ANON_KEY && SERVICE_KEY);

describe.skipIf(!HAS_LOCAL)('storage buckets', () => {
  let admin: SupabaseClient;
  beforeAll(() => { admin = createClient(SUPABASE_URL!, SERVICE_KEY!); });

  it('the paid `patterns` bucket exists and is PRIVATE', async () => {
    const { data, error } = await admin.storage.getBucket('patterns');
    expect(error).toBeNull();
    expect(data?.public).toBe(false);
  });

  it('the public `projects` bucket is public (contrast — proves the check is real)', async () => {
    const { data } = await admin.storage.getBucket('projects');
    expect(data?.public).toBe(true);
  });

  it('an anon client cannot list objects in the private bucket', async () => {
    const anon = createClient(SUPABASE_URL!, ANON_KEY!);
    const { data } = await anon.storage.from('patterns').list();
    // RLS denies → no objects surface to an unauthenticated caller.
    expect(data ?? []).toHaveLength(0);
  });
});
