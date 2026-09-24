import { describe, it, expect, vi } from 'vitest';
import { deleteListingPhoto, captionListingPhoto, reorderListingPhotos, uploadListingPhotos } from './listings';
import type { ServiceContext } from './types';

// Review 7 C2: the photo services must self-verify listing ownership (the route's
// inline check was the only gate; a caller that skips the route must still be
// denied). These prove the ownership gate rejects a non-owner BEFORE any mutation.

function ctxFor(listingSellerId: string | null, userId: string): { ctx: ServiceContext; mutated: string[] } {
  const mutated: string[] = [];
  const supabase = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null }) }),
          maybeSingle: async () =>
            table === 'listings' ? { data: listingSellerId ? { seller_id: listingSellerId } : null } : { data: null },
        }),
      }),
      // Any write here means the ownership gate FAILED to block.
      update: () => { mutated.push(`${table}.update`); return { eq: () => ({ eq: async () => ({ error: null }) }) }; },
      delete: () => { mutated.push(`${table}.delete`); return { eq: async () => ({ error: null }) }; },
      insert: () => { mutated.push(`${table}.insert`); return Promise.resolve({ error: null }); },
    }),
    storage: { from: () => ({ remove: async () => { mutated.push('storage.remove'); return { error: null }; } }) },
  };
  const ctx = {
    supabase: supabase as any,
    admin: supabase as any,
    user: { id: userId, email: 'x@y.io' },
    env: {},
  } as unknown as ServiceContext;
  return { ctx, mutated };
}

describe('photo services — ownership gate', () => {
  it('deleteListingPhoto denies a non-owner and mutates nothing', async () => {
    const { ctx, mutated } = ctxFor('seller-1', 'attacker');
    const r = await deleteListingPhoto(ctx, { listingId: 'l1', photoId: 'p1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
    expect(mutated).toEqual([]);
  });

  it('captionListingPhoto denies a non-owner', async () => {
    const { ctx, mutated } = ctxFor('seller-1', 'attacker');
    const r = await captionListingPhoto(ctx, { listingId: 'l1', photoId: 'p1', caption: 'x' });
    expect(r.ok).toBe(false);
    expect(mutated).toEqual([]);
  });

  it('reorderListingPhotos denies a non-owner', async () => {
    const { ctx, mutated } = ctxFor('seller-1', 'attacker');
    const r = await reorderListingPhotos(ctx, { listingId: 'l1', order: ['p1', 'p2'] });
    expect(r.ok).toBe(false);
    expect(mutated).toEqual([]);
  });

  it('uploadListingPhotos denies a non-owner', async () => {
    const { ctx, mutated } = ctxFor('seller-1', 'attacker');
    const r = await uploadListingPhotos(ctx, { listingId: 'l1', files: [] });
    expect(r.ok).toBe(false);
    expect(mutated).toEqual([]);
  });

  it('deleteListingPhoto denies when the listing is not readable (null)', async () => {
    const { ctx } = ctxFor(null, 'someone');
    const r = await deleteListingPhoto(ctx, { listingId: 'l1', photoId: 'p1' });
    expect(r.ok).toBe(false);
  });
});
