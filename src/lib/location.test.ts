import { describe, it, expect } from 'vitest';
import { roughLocation } from './location';

describe('roughLocation (privacy coarsening)', () => {
  it('passes a bare city through', () => {
    expect(roughLocation('Bergen')).toBe('Bergen');
    expect(roughLocation('  Oslo  ')).toBe('Oslo');
  });

  it('returns null for empty / missing input', () => {
    expect(roughLocation(null)).toBeNull();
    expect(roughLocation(undefined)).toBeNull();
    expect(roughLocation('')).toBeNull();
    expect(roughLocation('   ')).toBeNull();
  });

  it('drops a street line before a comma (never leaks the address)', () => {
    expect(roughLocation('Storgata 1, 5003 Bergen')).toBe('Bergen');
    expect(roughLocation('Kongens gate 12B, Oslo')).toBe('Oslo');
  });

  it('strips a leading Norwegian postal code', () => {
    expect(roughLocation('0181 Oslo')).toBe('Oslo');
    expect(roughLocation('Storgata 1, 0181 Oslo')).toBe('Oslo');
  });

  it('keeps multi-word areas intact', () => {
    expect(roughLocation('Bergen sentrum')).toBe('Bergen sentrum');
    expect(roughLocation('Nordre Aker, Oslo')).toBe('Oslo');
  });
});
