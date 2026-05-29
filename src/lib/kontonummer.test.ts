import { describe, it, expect } from 'vitest';
import { isValidKontonummer, normalizeKontonummer, formatKontonummer } from './kontonummer';

describe('isValidKontonummer', () => {
  // Known-good Norwegian bank account numbers. Test fixtures from
  // public examples (DNB demo accounts and similar).
  const VALID = [
    '12345678903',   // classic example used in NO docs
    '1234.56.78903', // dotted form
    '1234 56 78903', // spaced form
    '8601 11 17947', // another valid sample
  ];
  const INVALID = [
    '12345678901',           // wrong check digit
    '1234567890',            // too short
    '123456789012',          // too long
    '12345678abc',           // non-digits
    '',
    'abc def ghij',
  ];

  for (const k of VALID) {
    it(`accepts ${k}`, () => expect(isValidKontonummer(k)).toBe(true));
  }
  for (const k of INVALID) {
    it(`rejects ${k}`, () => expect(isValidKontonummer(k)).toBe(false));
  }

  it('rejects null and undefined', () => {
    expect(isValidKontonummer(null)).toBe(false);
    expect(isValidKontonummer(undefined)).toBe(false);
  });
});

describe('normalizeKontonummer', () => {
  it('strips spaces, dots, hyphens', () => {
    expect(normalizeKontonummer('1234 56 78903')).toBe('12345678903');
    expect(normalizeKontonummer('1234.56.78903')).toBe('12345678903');
    expect(normalizeKontonummer('1234-56-78903')).toBe('12345678903');
  });
});

describe('formatKontonummer', () => {
  it('renders 4-2-5 groups', () => {
    expect(formatKontonummer('12345678903')).toBe('1234 56 78903');
  });
  it('passes invalid through unchanged', () => {
    expect(formatKontonummer('not-a-number')).toBe('not-a-number');
  });
});
