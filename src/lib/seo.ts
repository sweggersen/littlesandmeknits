// Share-card / SEO helpers for marketplace detail pages.
//
// Layout.astro already emits the OpenGraph + Twitter tags from its
// `title` / `description` / `ogImage` props. These builders produce the
// per-item `description` and absolute `ogImage` so that sharing a seller,
// store, or commission link renders a rich card instead of the generic
// site fallback. The listing detail page already does this inline.
//
// Pure + env-free: callers pass an ALREADY-RESOLVED image URL (via
// projectPhotoUrl) so these functions are trivially unit-testable.

export const SITE_URL = 'https://littlesandmeknits.com';

/** Make a relative/storage URL absolute for OG tags. undefined if no url. */
export function absoluteUrl(url: string | null | undefined, site: string = SITE_URL): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, site).toString();
  } catch {
    return undefined;
  }
}

/** Collapse whitespace and clamp to ~max chars on a word boundary. */
export function clampDescription(text: string, max = 160): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, '').trim() + '…';
}

export interface ShareMeta {
  description: string;
  ogImage?: string;
}

export function sellerShareMeta(input: {
  displayName?: string | null;
  location?: string | null;
  avatarUrl?: string | null;
}): ShareMeta {
  const name = input.displayName?.trim() || 'Selger';
  const parts = [`Se håndstrikkede plagg fra ${name} på Strikketorget`];
  if (input.location?.trim()) parts.push(input.location.trim());
  return {
    description: clampDescription(parts.join('. ') + '.'),
    ogImage: absoluteUrl(input.avatarUrl),
  };
}

export function storeShareMeta(input: {
  name?: string | null;
  tagline?: string | null;
  logoUrl?: string | null;
}): ShareMeta {
  const name = input.name?.trim() || 'Butikk';
  const desc = input.tagline?.trim() || `Håndstrikkede plagg fra ${name} på Strikketorget.`;
  return {
    description: clampDescription(desc),
    ogImage: absoluteUrl(input.logoUrl),
  };
}

export function commissionShareMeta(input: {
  title?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
}): ShareMeta {
  const title = input.title?.trim() || 'Strikkeoppdrag';
  const parts = [title];
  if (input.budgetMin != null && input.budgetMax != null) {
    parts.push(`Budsjett ${input.budgetMin}–${input.budgetMax} kr`);
  }
  parts.push('Se oppdraget på Strikketorget');
  return { description: clampDescription(parts.join('. ') + '.') };
}
