import { describe, it, expect } from 'vitest';
import { createMockSupabase, hasFilter } from './mock-supabase';

describe('createMockSupabase', () => {
  it('returns single rows for maybeSingle/single', async () => {
    const mock = createMockSupabase({ read: { listings: { id: 'l1', status: 'active' } } });
    const { data } = await mock.client.from('listings').select('*').eq('id', 'l1').maybeSingle();
    expect(data).toEqual({ id: 'l1', status: 'active' });
  });

  it('wraps a single fixture as a list when awaited', async () => {
    const mock = createMockSupabase({ read: { listings: { id: 'l1' } } });
    const { data } = await mock.client.from('listings').select('*').eq('seller_id', 's1');
    expect(data).toEqual([{ id: 'l1' }]);
  });

  it('returns [] for a missing list fixture, null for a missing single', async () => {
    const mock = createMockSupabase({});
    const list = await mock.client.from('x').select('*').eq('a', 1);
    expect(list.data).toEqual([]);
    const one = await mock.client.from('x').select('*').eq('a', 1).maybeSingle();
    expect(one.data).toBeNull();
  });

  it('resolves fixtures as a function of the recorded filters', async () => {
    const mock = createMockSupabase({
      read: {
        profiles: (filters) => {
          const id = filters.find((f) => f.col === 'id')?.val;
          return id === 'amb' ? { role: 'ambassador' } : { role: 'user' };
        },
      },
    });
    const a = await mock.client.from('profiles').select('role').eq('id', 'amb').maybeSingle();
    const b = await mock.client.from('profiles').select('role').eq('id', 'joe').maybeSingle();
    expect(a.data).toEqual({ role: 'ambassador' });
    expect(b.data).toEqual({ role: 'user' });
  });

  it('records inserts with the payload', async () => {
    const mock = createMockSupabase({ insert: { listings: { data: { id: 'new' } } } });
    const { data } = await mock.client.from('listings').insert({ title: 'X' }).select('id').single();
    expect(data).toEqual({ id: 'new' });
    expect(mock.inserts('listings')).toHaveLength(1);
    expect(mock.inserts('listings')[0].payload).toEqual({ title: 'X' });
  });

  it('records updates with payload + filters', async () => {
    const mock = createMockSupabase({});
    await mock.client.from('listings').update({ status: 'sold' }).eq('id', 'l1');
    const upd = mock.updates('listings');
    expect(upd).toHaveLength(1);
    expect(upd[0].payload).toEqual({ status: 'sold' });
    expect(hasFilter(upd[0], 'id', 'l1')).toBe(true);
    expect(hasFilter(upd[0], 'id', 'WRONG')).toBe(false);
  });

  it('records count-head selects', async () => {
    const mock = createMockSupabase({ counts: { photos: 3 } });
    const { count } = await mock.client.from('photos').select('*', { count: 'exact', head: true }).eq('listing_id', 'l1');
    expect(count).toBe(3);
  });

  it('surfaces a configured insert error', async () => {
    const mock = createMockSupabase({ insert: { listings: { data: null, error: { message: 'dup' } } } });
    const { error } = await mock.client.from('listings').insert({}).select('id').single();
    expect(error).toEqual({ message: 'dup' });
  });

  it('threads .in() / .order() / .limit() without breaking', async () => {
    const mock = createMockSupabase({ read: { listings: [{ id: 'a' }, { id: 'b' }] } });
    const { data } = await mock.client
      .from('listings').select('*').in('id', ['a', 'b']).order('created_at').limit(10);
    expect(data).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});
