// Slug generation and uniqueness checks for store URLs.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Reserved slugs that can't be claimed by stores. */
const RESERVED = new Set([
  'admin', 'api', 'auth', 'about', 'help', 'support',
  'login', 'logout', 'signup', 'profile', 'profiles',
  'market', 'marked', 'studio', 'strikketorget', 'strikkestua',
  'new', 'edit', 'delete', 'settings', 'dashboard',
  'stores', 'store', 'shop', 'shops', 'butikk', 'butikker',
  'listings', 'commissions', 'messages', 'reviews', 'favorites',
  'terms', 'privacy', 'vilkar', 'personvern',
  'patterns', 'projects', 'oppskrifter', 'prosjekter',
]);

/** Slugify a store name: lowercase, ASCII, hyphens. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function isReserved(slug: string): boolean {
  return RESERVED.has(slug);
}

/**
 * Given a desired slug, return a unique slug — appending -2, -3, … if needed.
 * Uses the admin client so we can see all (incl. deleted/draft) stores.
 */
export async function ensureUniqueSlug(
  admin: SupabaseClient,
  base: string,
): Promise<string | null> {
  if (!base) return null;
  if (isReserved(base)) return null;

  // SOFT_DELETE_EXCEPTION_NOTE: include soft-deleted slugs — the unique
  // constraint on stores.slug ignores deleted_at, so a deleted-but-not-purged
  // store still owns its slug. Excluding deleted rows here would let us
  // hand out the same slug twice and get a constraint violation on insert.
  const { data: existing } = await admin
    .from('stores')
    .select('slug')
    .ilike('slug', `${base}%`);

  const taken = new Set((existing ?? []).map((s) => s.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

export function isValidSlugSyntax(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 3 && slug.length <= 48;
}
