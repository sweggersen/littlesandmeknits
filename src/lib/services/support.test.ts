import { describe, it, expect } from 'vitest';
import { createFakeDb } from './__test_helpers__/fake-db';
import { submitSupportRequest, listSupportRequests, resolveSupportRequest } from './support';
import type { ServiceContext } from './types';

function ctxFor(db: ReturnType<typeof createFakeDb>, userId = 'u1', email = 'u1@test.no'): ServiceContext {
  return { admin: db.client, supabase: db.client, user: { id: userId, email }, env: {} } as unknown as ServiceContext;
}

const baseSeed = () => ({
  profiles: [
    { id: 'u1', role: 'user' },
    { id: 'mod1', role: 'moderator' },
  ],
  support_requests: [] as Record<string, unknown>[],
  user_action_counts: [] as Record<string, unknown>[],
});

describe('submitSupportRequest', () => {
  it('rejects an empty / too-short body', async () => {
    const db = createFakeDb(baseSeed());
    const r = await submitSupportRequest(ctxFor(db), { body: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_input');
    expect(db.rows('support_requests').length).toBe(0);
  });

  it('stores a valid request for the signed-in user with normalised category', async () => {
    const db = createFakeDb(baseSeed());
    const r = await submitSupportRequest(ctxFor(db), { category: 'bogus', subject: 'Hjelp', body: 'Jeg lurer på noe om betaling.' });
    expect(r.ok).toBe(true);
    const row = db.find('support_requests', { user_id: 'u1' })!;
    expect(row.body).toContain('betaling');
    expect(row.category).toBe('annet'); // invalid category falls back
    expect(row.status).toBe('open');
    expect(row.email).toBe('u1@test.no');
  });

  it('keeps a known category', async () => {
    const db = createFakeDb(baseSeed());
    await submitSupportRequest(ctxFor(db), { category: 'salg', body: 'Hvordan selger jeg?' });
    expect(db.find('support_requests', { user_id: 'u1' })!.category).toBe('salg');
  });
});

describe('listSupportRequests / resolveSupportRequest', () => {
  const seedWith = () => createFakeDb({
    profiles: [{ id: 'u1', role: 'user' }, { id: 'mod1', role: 'moderator' }],
    support_requests: [
      { id: 's1', user_id: 'u1', email: 'a@test.no', category: 'kjop', subject: null, body: 'A', status: 'open', created_at: '2026-06-01T00:00:00Z', resolved_at: null, handled_note: null },
      { id: 's2', user_id: 'u1', email: 'b@test.no', category: 'annet', subject: 'X', body: 'B', status: 'resolved', created_at: '2026-05-30T00:00:00Z', resolved_at: '2026-05-31T00:00:00Z', handled_note: 'fikset' },
    ],
  });

  it('non-staff cannot list', async () => {
    const r = await listSupportRequests(ctxFor(seedWith(), 'u1'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('staff sees open + resolved split', async () => {
    const r = await listSupportRequests(ctxFor(seedWith(), 'mod1'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.open.map((x) => x.id)).toEqual(['s1']);
    expect(r.data.resolved.map((x) => x.id)).toEqual(['s2']);
  });

  it('non-staff cannot resolve', async () => {
    const r = await resolveSupportRequest(ctxFor(seedWith(), 'u1'), { id: 's1' });
    expect(r.ok).toBe(false);
  });

  it('staff resolves a request', async () => {
    const db = seedWith();
    const r = await resolveSupportRequest(ctxFor(db, 'mod1'), { id: 's1', note: 'svart på e-post' });
    expect(r.ok).toBe(true);
    const row = db.find('support_requests', { id: 's1' })!;
    expect(row.status).toBe('resolved');
    expect(row.resolved_by).toBe('mod1');
    expect(row.handled_note).toBe('svart på e-post');
  });
});
