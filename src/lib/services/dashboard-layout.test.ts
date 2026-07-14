import { describe, it, expect } from 'vitest';
import { sanitizeLayout } from './dashboard-layout';

describe('sanitizeLayout', () => {
  it('keeps well-formed items in order', () => {
    const input = [
      { widget: 'needsAttention', size: 'm' },
      { widget: 'badges', size: 'l' },
    ];
    expect(sanitizeLayout(input)).toEqual(input);
  });

  it('rejects non-array input', () => {
    expect(sanitizeLayout(null)).toBeNull();
    expect(sanitizeLayout({})).toBeNull();
    expect(sanitizeLayout('[]')).toBeNull(); // a string, not an array
  });

  it('drops items with an invalid size', () => {
    const out = sanitizeLayout([
      { widget: 'a', size: 'xl' },
      { widget: 'b', size: 'm' },
    ]);
    expect(out).toEqual([{ widget: 'b', size: 'm' }]);
  });

  it('drops items with a malformed widget key', () => {
    const out = sanitizeLayout([
      { widget: '', size: 's' },
      { widget: 'has space', size: 's' },
      { widget: '1leading-digit', size: 's' },
      { widget: 'valid_key-1', size: 's' },
    ]);
    expect(out).toEqual([{ widget: 'valid_key-1', size: 's' }]);
  });

  it('de-duplicates by widget, keeping the first occurrence', () => {
    const out = sanitizeLayout([
      { widget: 'dup', size: 's' },
      { widget: 'dup', size: 'l' },
    ]);
    expect(out).toEqual([{ widget: 'dup', size: 's' }]);
  });

  it('caps the number of items to guard against blob stuffing', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ widget: `w${i}`, size: 'm' }));
    expect(sanitizeLayout(many)).toHaveLength(32);
  });

  it('ignores junk entries without throwing', () => {
    const out = sanitizeLayout([null, 42, 'x', { widget: 'ok', size: 'm' }, undefined]);
    expect(out).toEqual([{ widget: 'ok', size: 'm' }]);
  });
});
