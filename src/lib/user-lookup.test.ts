import { describe, it, expect, vi } from 'vitest';
import { findAuthUserByEmail } from './user-lookup';

// Build an admin stub whose listUsers pages through `users` 1000 at a time.
function adminWith(users: Array<{ id: string; email: string }>) {
  const listUsers = vi.fn(async ({ page, perPage }: { page: number; perPage: number }) => {
    const start = (page - 1) * perPage;
    return { data: { users: users.slice(start, start + perPage) } };
  });
  return { admin: { auth: { admin: { listUsers } } } as any, listUsers };
}

describe('findAuthUserByEmail', () => {
  it('finds a user on the first page', async () => {
    const { admin } = adminWith([{ id: 'a', email: 'a@x.io' }, { id: 'b', email: 'b@x.io' }]);
    expect(await findAuthUserByEmail(admin, 'b@x.io')).toEqual({ id: 'b', email: 'b@x.io' });
  });

  it('is case-insensitive and trims', async () => {
    const { admin } = adminWith([{ id: 'a', email: 'Kari@Example.NO' }]);
    expect(await findAuthUserByEmail(admin, '  kari@example.no ')).toEqual({ id: 'a', email: 'Kari@Example.NO' });
  });

  it('finds a user PAST the first 1000 (paginates) — the bug this fixes', async () => {
    const users = Array.from({ length: 1500 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.io` }));
    const { admin, listUsers } = adminWith(users);
    const found = await findAuthUserByEmail(admin, 'u1234@x.io'); // position 1235
    expect(found).toEqual({ id: 'u1234', email: 'u1234@x.io' });
    expect(listUsers).toHaveBeenCalledTimes(2); // needed a second page
  });

  it('returns null when no user matches (and stops at the last partial page)', async () => {
    const users = Array.from({ length: 1200 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.io` }));
    const { admin, listUsers } = adminWith(users);
    expect(await findAuthUserByEmail(admin, 'nobody@x.io')).toBeNull();
    expect(listUsers).toHaveBeenCalledTimes(2); // page 1 full, page 2 partial → stop
  });

  it('returns null for an empty email', async () => {
    const { admin, listUsers } = adminWith([{ id: 'a', email: 'a@x.io' }]);
    expect(await findAuthUserByEmail(admin, '  ')).toBeNull();
    expect(listUsers).not.toHaveBeenCalled();
  });
});
