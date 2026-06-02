import { describe, it, expect } from 'vitest';
import {
  absoluteUrl, clampDescription, sellerShareMeta, storeShareMeta, commissionShareMeta, SITE_URL,
} from './seo';

describe('absoluteUrl', () => {
  it('returns undefined for empty input', () => {
    expect(absoluteUrl(null)).toBeUndefined();
    expect(absoluteUrl(undefined)).toBeUndefined();
    expect(absoluteUrl('')).toBeUndefined();
  });
  it('makes a root-relative path absolute against the site', () => {
    expect(absoluteUrl('/storage/a.jpg')).toBe(`${SITE_URL}/storage/a.jpg`);
  });
  it('passes an already-absolute URL through', () => {
    expect(absoluteUrl('https://cdn.example.com/x.jpg')).toBe('https://cdn.example.com/x.jpg');
  });
});

describe('clampDescription', () => {
  it('collapses whitespace', () => {
    expect(clampDescription('a\n  b   c')).toBe('a b c');
  });
  it('clamps on a word boundary with an ellipsis', () => {
    const out = clampDescription('one two three four five', 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('  ');
  });
  it('leaves short text untouched', () => {
    expect(clampDescription('short', 160)).toBe('short');
  });
});

describe('sellerShareMeta', () => {
  it('builds a name-based description + absolute avatar ogImage', () => {
    const m = sellerShareMeta({ displayName: 'Kari', location: 'Oslo', avatarUrl: '/storage/av.jpg' });
    expect(m.description).toContain('Kari');
    expect(m.description).toContain('Oslo');
    expect(m.ogImage).toBe(`${SITE_URL}/storage/av.jpg`);
  });
  it('falls back gracefully with no name and no avatar', () => {
    const m = sellerShareMeta({});
    expect(m.description).toContain('Selger');
    expect(m.ogImage).toBeUndefined();
  });
});

describe('storeShareMeta', () => {
  it('uses the tagline + logo when present', () => {
    const m = storeShareMeta({ name: 'Garnglede', tagline: 'Strikk fra hjertet', logoUrl: '/storage/logo.png' });
    expect(m.description).toBe('Strikk fra hjertet');
    expect(m.ogImage).toBe(`${SITE_URL}/storage/logo.png`);
  });
  it('falls back to a generated description when no tagline', () => {
    const m = storeShareMeta({ name: 'Garnglede', tagline: null, logoUrl: null });
    expect(m.description).toContain('Garnglede');
    expect(m.ogImage).toBeUndefined();
  });
});

describe('commissionShareMeta', () => {
  it('includes title + budget range', () => {
    const m = commissionShareMeta({ title: 'Strikk en genser', budgetMin: 800, budgetMax: 1500 });
    expect(m.description).toContain('Strikk en genser');
    expect(m.description).toContain('800–1500 kr');
  });
  it('omits budget when missing, still has a description', () => {
    const m = commissionShareMeta({ title: 'Lue', budgetMin: null, budgetMax: null });
    expect(m.description).toContain('Lue');
    expect(m.description).not.toContain('Budsjett');
  });
  it('commission cards carry no ogImage (requests have no hero photo)', () => {
    expect(commissionShareMeta({ title: 'x' }).ogImage).toBeUndefined();
  });
});
