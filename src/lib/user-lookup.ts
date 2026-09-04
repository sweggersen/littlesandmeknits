// Find an auth user by email. GoTrue has no by-email admin filter and listUsers
// is paginated at 1000/page, so a single perPage:1000 call silently misses
// everyone past position 1000. This scans all pages until a match or the last
// page — the correct lookup wherever we resolve email → user id (store invites,
// Vipps linking, dev tooling). Returns null if no user has that email.
//
// TODO: replace with admin.auth.getUserByEmail once the supabase-js version
// exposes it.

import type { TypedSupabaseClient } from './supabase';

const PER_PAGE = 1000;
const MAX_PAGES = 100; // 100k users — a hard backstop, not a real limit

export async function findAuthUserByEmail(
  admin: TypedSupabaseClient,
  email: string,
): Promise<{ id: string; email: string | null } | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: PER_PAGE, page });
    const match = list?.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return { id: match.id, email: match.email ?? null };
    if (!list?.users.length || list.users.length < PER_PAGE) break; // last page
  }
  return null;
}
