import { describe, it, expect } from 'vitest';
import { slugify, isReserved, isValidSlugSyntax } from './store-slug';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('My Store')).toBe('my-store');
    expect(slugify('HELLO WORLD!!!')).toBe('hello-world');
  });

  it('handles Norwegian characters', () => {
    expect(slugify('Æble & Øster')).toBe('aeble-oster');
    expect(slugify('Strikkebua på Hamar')).toBe('strikkebua-pa-hamar');
  });

  it('strips diacritics', () => {
    expect(slugify('café résumé')).toBe('cafe-resume');
  });

  it('collapses runs of separators', () => {
    expect(slugify('a   --  b')).toBe('a-b');
    expect(slugify('--abc--')).toBe('abc');
  });

  it('limits to 48 chars', () => {
    const long = 'a'.repeat(60);
    expect(slugify(long).length).toBeLessThanOrEqual(48);
  });

  it('returns empty for input with no slug-safe chars', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('  ')).toBe('');
  });
});

describe('isReserved', () => {
  it('rejects core route names', () => {
    expect(isReserved('admin')).toBe(true);
    expect(isReserved('market')).toBe(true);
    expect(isReserved('login')).toBe(true);
    expect(isReserved('api')).toBe(true);
  });

  it('rejects Norwegian aliases', () => {
    expect(isReserved('marked')).toBe(true);
    expect(isReserved('butikk')).toBe(true);
    expect(isReserved('vilkar')).toBe(true);
  });

  it('allows ordinary store names', () => {
    expect(isReserved('strikkebua')).toBe(false);
    expect(isReserved('my-store')).toBe(false);
  });
});

describe('isValidSlugSyntax', () => {
  it('accepts proper kebab-case 3-48 chars', () => {
    expect(isValidSlugSyntax('abc')).toBe(true);
    expect(isValidSlugSyntax('my-store')).toBe(true);
    expect(isValidSlugSyntax('store-123-with-hyphens')).toBe(true);
  });

  it('rejects too-short slugs', () => {
    expect(isValidSlugSyntax('ab')).toBe(false);
    expect(isValidSlugSyntax('')).toBe(false);
  });

  it('rejects too-long slugs', () => {
    expect(isValidSlugSyntax('a'.repeat(49))).toBe(false);
  });

  it('rejects uppercase / spaces / special chars', () => {
    expect(isValidSlugSyntax('My-Store')).toBe(false);
    expect(isValidSlugSyntax('my store')).toBe(false);
    expect(isValidSlugSyntax('my_store')).toBe(false);
    expect(isValidSlugSyntax('-leading')).toBe(false);
    expect(isValidSlugSyntax('trailing-')).toBe(false);
    expect(isValidSlugSyntax('double--hyphen')).toBe(false);
  });
});
