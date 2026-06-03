import { describe, it, expect } from 'vitest';
import { LISTING_TEMPLATES } from './listing-templates';
import { VALID_CATEGORIES, CONDITION_LABEL } from './labels';

// These presets prefill the new-listing form. If a category/kind/condition
// here doesn't match what the server accepts, the seller's first listing would
// fail validation on submit — guard that at build/test time.
describe('LISTING_TEMPLATES', () => {
  const entries = Object.entries(LISTING_TEMPLATES);

  it('offers a spread of starter templates incl. preloved + new', () => {
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

  it.each(entries)('%s template uses a valid category and kind', (_key, tpl) => {
    expect(VALID_CATEGORIES.has(tpl.category)).toBe(true);
    expect(['pre_loved', 'ready_made']).toContain(tpl.kind);
    expect(tpl.title.length).toBeGreaterThan(0);
    expect(Number(tpl.price_nok)).toBeGreaterThan(0);
  });

  it('preloved template carries a valid condition; new omits it', () => {
    expect(LISTING_TEMPLATES.preloved.condition).toBeDefined();
    expect(CONDITION_LABEL[LISTING_TEMPLATES.preloved.condition!]).toBeDefined();
    expect(LISTING_TEMPLATES.new.condition).toBeUndefined();
  });

  it('keeps copy free of em-dashes', () => {
    for (const [, tpl] of entries) {
      expect(tpl.description).not.toContain('—');
      expect(tpl.title).not.toContain('—');
    }
  });
});
