import { describe, it, expect } from 'vitest';
import { createFakeDb } from './fake-db';

describe('createFakeDb — filters are actually applied', () => {
  it('returns the seeded row only for the matching id', async () => {
    const db = createFakeDb({ listings: [{ id: 'l1', title: 'A' }, { id: 'l2', title: 'B' }] });
    const hit = await db.client.from('listings').select('*').eq('id', 'l2').maybeSingle();
    expect(hit.data).toMatchObject({ id: 'l2', title: 'B' });
  });

  it('returns null when the id does not match — catches wrong-row queries', async () => {
    const db = createFakeDb({ listings: [{ id: 'l1', title: 'A' }] });
    const miss = await db.client.from('listings').select('*').eq('id', 'WRONG').maybeSingle();
    expect(miss.data).toBeNull();
  });

  it('applies multiple eq filters (AND)', async () => {
    const db = createFakeDb({
      store_members: [
        { store_id: 's1', user_id: 'u1', role: 'owner' },
        { store_id: 's1', user_id: 'u2', role: 'member' },
      ],
    });
    const hit = await db.client.from('store_members')
      .select('role').eq('store_id', 's1').eq('user_id', 'u2').maybeSingle();
    expect(hit.data).toMatchObject({ role: 'member' });
    const miss = await db.client.from('store_members')
      .select('role').eq('store_id', 's1').eq('user_id', 'nobody').maybeSingle();
    expect(miss.data).toBeNull();
  });

  it('supports in / is / neq / gte / lte', async () => {
    const db = createFakeDb({
      listings: [
        { id: 'a', price: 100, deleted_at: null },
        { id: 'b', price: 300, deleted_at: '2026-01-01' },
        { id: 'c', price: 500, deleted_at: null },
      ],
    });
    const inResult = await db.client.from('listings').select('*').in('id', ['a', 'c']);
    expect((inResult.data as any[]).map((r) => r.id)).toEqual(['a', 'c']);

    const isResult = await db.client.from('listings').select('*').is('deleted_at', null);
    expect((isResult.data as any[]).map((r) => r.id)).toEqual(['a', 'c']);

    const gte = await db.client.from('listings').select('*').gte('price', 300);
    expect((gte.data as any[]).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('parses an .or() expression', async () => {
    const db = createFakeDb({
      conversations: [
        { id: '1', buyer_id: 'me', seller_id: 'x' },
        { id: '2', buyer_id: 'y', seller_id: 'me' },
        { id: '3', buyer_id: 'y', seller_id: 'z' },
      ],
    });
    const r = await db.client.from('conversations').select('*').or('buyer_id.eq.me,seller_id.eq.me');
    expect((r.data as any[]).map((x) => x.id)).toEqual(['1', '2']);
  });

  it('single() errors when zero rows match (like PostgREST)', async () => {
    const db = createFakeDb({ listings: [] });
    const r = await db.client.from('listings').select('*').eq('id', 'x').single();
    expect(r.data).toBeNull();
    expect(r.error).not.toBeNull();
  });
});

describe('createFakeDb — mutations change state', () => {
  it('insert pushes a row and assigns an id', async () => {
    const db = createFakeDb({});
    const r = await db.client.from('listings').insert({ title: 'New' }).select('id').single();
    expect((r.data as any).id).toBeDefined();
    expect(db.rows('listings')).toHaveLength(1);
    expect(db.rows('listings')[0]).toMatchObject({ title: 'New' });
  });

  it('insert honors an explicit id', async () => {
    const db = createFakeDb({});
    await db.client.from('listings').insert({ id: 'fixed', title: 'X' });
    expect(db.find('listings', { id: 'fixed' })).toMatchObject({ title: 'X' });
  });

  it('update mutates only matching rows', async () => {
    const db = createFakeDb({ listings: [{ id: 'l1', status: 'active' }, { id: 'l2', status: 'active' }] });
    await db.client.from('listings').update({ status: 'sold' }).eq('id', 'l1');
    expect(db.find('listings', { id: 'l1' })).toMatchObject({ status: 'sold' });
    expect(db.find('listings', { id: 'l2' })).toMatchObject({ status: 'active' });
  });

  it('update().select() returns the updated rows', async () => {
    const db = createFakeDb({
      offers: [
        { id: 'o1', request_id: 'r1', status: 'pending', knitter_id: 'k1' },
        { id: 'o2', request_id: 'r1', status: 'pending', knitter_id: 'k2' },
      ],
    });
    const r = await db.client.from('offers')
      .update({ status: 'declined' }).eq('request_id', 'r1').neq('id', 'o1').select('knitter_id');
    expect((r.data as any[]).map((x) => x.knitter_id)).toEqual(['k2']);
  });

  it('delete removes matching rows', async () => {
    const db = createFakeDb({ listings: [{ id: 'l1' }, { id: 'l2' }] });
    await db.client.from('listings').delete().eq('id', 'l1');
    expect(db.rows('listings').map((r) => r.id)).toEqual(['l2']);
  });

  it('count-head returns the matching count', async () => {
    const db = createFakeDb({ photos: [{ listing_id: 'l1' }, { listing_id: 'l1' }, { listing_id: 'l2' }] });
    const r = await db.client.from('photos').select('*', { count: 'exact', head: true }).eq('listing_id', 'l1');
    expect(r.count).toBe(2);
  });
});
