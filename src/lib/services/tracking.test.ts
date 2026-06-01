import { describe, it, expect } from 'vitest';
import { recordImpressions, recordClick } from './tracking';
import type { ServiceContext } from './types';

function mockClient(opts?: { insertResult?: { error: { message: string } | null } }) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const client = {
    from: (_table: string) => ({
      insert: async (rows: unknown) => {
        inserts.push(rows);
        return opts?.insertResult ?? { error: null };
      },
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: { id: 'imp-1' } }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
      update: (row: unknown) => ({
        eq: async () => {
          updates.push(row);
          return { error: null };
        },
      }),
    }),
  };
  return { client, inserts, updates };
}

describe('recordImpressions', () => {
  it('rejects invalid source', async () => {
    const { client } = mockClient();
    const result = await recordImpressions({
      source: 'invalid',
      rows: [{ listing_id: 'l1' }],
      viewerId: 'u1',
      client: client as any,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_input');
  });

  it('rejects empty rows', async () => {
    const { client } = mockClient();
    const result = await recordImpressions({
      source: 'feed', rows: [], viewerId: 'u1', client: client as any,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects > 50 rows', async () => {
    const { client } = mockClient();
    const rows = Array.from({ length: 51 }, (_, i) => ({ listing_id: `l${i}` }));
    const result = await recordImpressions({
      source: 'feed', rows, viewerId: 'u1', client: client as any,
    });
    expect(result.ok).toBe(false);
  });

  it('filters out rows with empty listing_id', async () => {
    const { client, inserts } = mockClient();
    await recordImpressions({
      source: 'feed',
      rows: [
        { listing_id: 'l1' },
        { listing_id: '' as any },
        { listing_id: 'l2' },
      ],
      viewerId: 'u1', client: client as any,
    });
    expect((inserts[0] as any[])).toHaveLength(2);
  });

  it('rejects when all rows have invalid listing_id', async () => {
    const { client } = mockClient();
    const result = await recordImpressions({
      source: 'feed',
      rows: [{ listing_id: '' as any }],
      viewerId: 'u1', client: client as any,
    });
    expect(result.ok).toBe(false);
  });

  it('clamps position to int16 max', async () => {
    const { client, inserts } = mockClient();
    await recordImpressions({
      source: 'feed',
      rows: [{ listing_id: 'l1', position: 99999 }],
      viewerId: 'u1', client: client as any,
    });
    expect((inserts[0] as any[])[0].position).toBe(32767);
  });

  it('drops invalid tier', async () => {
    const { client, inserts } = mockClient();
    await recordImpressions({
      source: 'feed',
      rows: [{ listing_id: 'l1', tier: 'invalid' as any }],
      viewerId: 'u1', client: client as any,
    });
    expect((inserts[0] as any[])[0].tier).toBeNull();
  });

  it('keeps valid tier', async () => {
    const { client, inserts } = mockClient();
    await recordImpressions({
      source: 'search',
      rows: [{ listing_id: 'l1', tier: 'boost' }],
      viewerId: null, client: client as any,
    });
    expect((inserts[0] as any[])[0].tier).toBe('boost');
    expect((inserts[0] as any[])[0].viewer_id).toBeNull();
  });

  it('surfaces insert errors as server_error', async () => {
    const { client } = mockClient({
      insertResult: { error: { message: 'DB blew up' } },
    });
    const result = await recordImpressions({
      source: 'feed', rows: [{ listing_id: 'l1' }],
      viewerId: 'u1', client: client as any,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('server_error');
  });
});

describe('recordClick', () => {
  function mockCtx() {
    const { client, updates } = mockClient();
    const ctx: ServiceContext = {
      supabase: client as any,
      admin: client as any,
      user: { id: 'u1', email: 't@x.io' },
      env: {},
    };
    return { ctx, updates };
  }

  it('rejects missing listing_id', async () => {
    const { ctx } = mockCtx();
    const result = await recordClick(ctx, { listingId: '', source: 'feed' });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid source', async () => {
    const { ctx } = mockCtx();
    const result = await recordClick(ctx, { listingId: 'l1', source: 'invalid' });
    expect(result.ok).toBe(false);
  });

  it('marks the recent impression clicked when found', async () => {
    const { ctx, updates } = mockCtx();
    const result = await recordClick(ctx, { listingId: 'l1', source: 'feed' });
    expect(result.ok).toBe(true);
    expect(updates).toHaveLength(1);
    const u = updates[0] as Record<string, unknown>;
    expect(u.clicked).toBe(true);
    expect(typeof u.clicked_at).toBe('string');
  });
});
