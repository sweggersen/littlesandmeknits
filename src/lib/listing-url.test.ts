import { describe, it, expect } from 'vitest';
import { slugifyTitle, listingPath, extractListingId } from './listing-url';

describe('slugifyTitle', () => {
  it('handles Norwegian diacritics', () => {
    expect(slugifyTitle('Mariusgenser str. 92, naturhvit')).toBe('mariusgenser-str-92-naturhvit');
    expect(slugifyTitle('Bursdagskåpe — størrelse 2 år')).toBe('bursdagskape-storrelse-2-ar');
    expect(slugifyTitle('Æbleskive øl å la mode')).toBe('aebleskive-ol-a-la-mode');
  });

  it('caps at 60 chars', () => {
    const long = 'A'.repeat(200);
    expect(slugifyTitle(long).length).toBe(60);
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugifyTitle('---Strikket---')).toBe('strikket');
  });
});

describe('listingPath', () => {
  it('produces slug-id format when title is present', () => {
    expect(listingPath({ id: '12345678-1234-1234-1234-123456789abc', title: 'Strikket genser str 2 år' }))
      .toBe('/market/listing/strikket-genser-str-2-ar-12345678-1234-1234-1234-123456789abc');
  });

  it('falls back to bare id when title is missing', () => {
    expect(listingPath({ id: '12345678-1234-1234-1234-123456789abc', title: '' }))
      .toBe('/market/listing/12345678-1234-1234-1234-123456789abc');
  });
});

describe('extractListingId', () => {
  it('extracts UUID from pretty URL form', () => {
    expect(extractListingId('strikket-genser-str-2-ar-12345678-1234-1234-1234-123456789abc'))
      .toBe('12345678-1234-1234-1234-123456789abc');
  });

  it('extracts UUID from bare-UUID form', () => {
    expect(extractListingId('12345678-1234-1234-1234-123456789abc'))
      .toBe('12345678-1234-1234-1234-123456789abc');
  });

  it('returns null when no UUID is present', () => {
    expect(extractListingId('not-a-listing-at-all')).toBeNull();
    expect(extractListingId('')).toBeNull();
    expect(extractListingId(undefined)).toBeNull();
  });

  it('only matches UUID at the end of the param (security: slug cannot shadow id)', () => {
    expect(extractListingId('12345678-1234-1234-1234-123456789abc-extra')).toBeNull();
  });
});
