import { describe, it, expect } from 'vitest';
import { LISTING_TEMPLATES } from './listing-templates';
import { VALID_CATEGORIES } from './labels';

// First-listing chips set only TYPE (kind) + CATEGORY. If a category/kind here
// doesn't match what the server accepts, the seller's first listing would fail
// validation on submit — guard that at build/test time.
describe('LISTING_TEMPLATES', () => {
  const entries = Object.entries(LISTING_TEMPLATES);

  it('offers a spread of starter chips incl. preloved + new', () => {
    const keys = Object.keys(LISTING_TEMPLATES);
    expect(keys).toEqual(expect.arrayContaining(['preloved', 'new', 'cardigan', 'blanket', 'accessories']));
    expect(keys.length).toBeGreaterThanOrEqual(5);
  });

  it('covers more than one category and both kinds', () => {
    const cats = new Set(entries.map(([, t]) => t.category));
    const kinds = new Set(entries.map(([, t]) => t.kind));
    expect(cats.size).toBeGreaterThanOrEqual(4);
    expect(kinds).toEqual(new Set(['pre_loved', 'ready_made']));
  });

  it.each(entries)('%s chip uses a valid category and kind', (_key, tpl) => {
    expect(VALID_CATEGORIES.has(tpl.category)).toBe(true);
    expect(['pre_loved', 'ready_made']).toContain(tpl.kind);
  });

  it('sets ONLY kind + category — no prefilled detail fields', () => {
    for (const [, tpl] of entries) {
      expect(Object.keys(tpl).sort()).toEqual(['category', 'kind']);
    }
  });
});
