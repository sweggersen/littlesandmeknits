import { describe, it, expect, vi } from 'vitest';
import { editProfile, setBirthday } from './profile';

type Captured = { table: string; update: Record<string, unknown>; eq: [string, unknown] };

function makeCtx() {
  const updates: Captured[] = [];
  const ctx = {
    user: { id: 'user-123', user_metadata: {} },
    supabase: {
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
      from(table: string) {
        return {
          update(payload: Record<string, unknown>) {
            return {
              eq: (col: string, val: unknown) => {
                updates.push({ table, update: payload, eq: [col, val] });
                return { then: (r: any) => r({ data: null, error: null }) };
              },
            };
          },
        };
      },
      auth: { updateUser: vi.fn(async () => ({ data: null, error: null })) },
    },
  } as any;
  return { ctx, updates };
}

describe('editProfile', () => {
  it('persists first_name + last_name + display_name', async () => {
    const { ctx, updates } = makeCtx();
    await editProfile(ctx, {
      firstName: 'Eline', lastName: 'Berge', displayName: 'Eline B',
      sellerTags: [], profileVisible: true,
    });
    const profile = updates.find((u) => u.table === 'profiles');
    expect(profile?.update.first_name).toBe('Eline');
    expect(profile?.update.last_name).toBe('Berge');
    expect(profile?.update.display_name).toBe('Eline B');
  });

  it('auto-composes display_name from first+last when display_name is blank', async () => {
    const { ctx, updates } = makeCtx();
    await editProfile(ctx, {
      firstName: 'Eline', lastName: 'Berge', displayName: '',
      sellerTags: [], profileVisible: true,
    });
    const profile = updates.find((u) => u.table === 'profiles');
    expect(profile?.update.display_name).toBe('Eline Berge');
  });

  it('leaves display_name null when both name fields are blank', async () => {
    const { ctx, updates } = makeCtx();
    await editProfile(ctx, {
      firstName: '', lastName: '', displayName: '',
      sellerTags: [], profileVisible: true,
    });
    const profile = updates.find((u) => u.table === 'profiles');
    expect(profile?.update.display_name).toBeNull();
  });

  it('trims and length-caps name fields', async () => {
    const { ctx, updates } = makeCtx();
    const long = 'a'.repeat(80);
    await editProfile(ctx, {
      firstName: `  ${long}  `, lastName: long, displayName: '',
      sellerTags: [], profileVisible: true,
    });
    const profile = updates.find((u) => u.table === 'profiles');
    expect((profile?.update.first_name as string).length).toBe(40);
    expect((profile?.update.last_name as string).length).toBe(40);
  });
});

describe('setBirthday', () => {
  it('persists a valid date as YYYY-MM-DD', async () => {
    const { ctx, updates } = makeCtx();
    const r = await setBirthday(ctx, { day: 21, month: 8, year: 1989 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.birthday).toBe('1989-08-21');
    const profile = updates.find((u) => u.table === 'profiles');
    expect(profile?.update.birthday).toBe('1989-08-21');
  });

  it('rejects nonsensical dates (Feb 30)', async () => {
    const { ctx } = makeCtx();
    const r = await setBirthday(ctx, { day: 30, month: 2, year: 1990 });
    expect(r.ok).toBe(false);
  });

  it('rejects future years', async () => {
    const { ctx } = makeCtx();
    const future = new Date().getFullYear() + 1;
    const r = await setBirthday(ctx, { day: 1, month: 1, year: future });
    expect(r.ok).toBe(false);
  });

  it('rejects 1899 and earlier (impossible birth years)', async () => {
    const { ctx } = makeCtx();
    const r = await setBirthday(ctx, { day: 1, month: 1, year: 1899 });
    expect(r.ok).toBe(false);
  });

  it('rejects out-of-range day/month', async () => {
    const { ctx } = makeCtx();
    expect((await setBirthday(ctx, { day: 0, month: 6, year: 1990 })).ok).toBe(false);
    expect((await setBirthday(ctx, { day: 32, month: 6, year: 1990 })).ok).toBe(false);
    expect((await setBirthday(ctx, { day: 1, month: 0, year: 1990 })).ok).toBe(false);
    expect((await setBirthday(ctx, { day: 1, month: 13, year: 1990 })).ok).toBe(false);
  });
});
