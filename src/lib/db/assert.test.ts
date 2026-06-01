import { describe, it, expect } from 'vitest';
import { assertUuid, asUuid, assertSafeForOrFilter, orEither } from './assert';

const VALID = '12345678-1234-1234-1234-123456789012';

describe('assertUuid', () => {
  it('passes a canonical UUID', () => {
    expect(() => assertUuid(VALID)).not.toThrow();
  });

  it('throws on a non-string', () => {
    expect(() => assertUuid(123)).toThrow(/Invalid UUID/);
    expect(() => assertUuid(null)).toThrow(/Invalid UUID/);
    expect(() => assertUuid(undefined)).toThrow(/Invalid UUID/);
  });

  it('throws on a string that is not a UUID', () => {
    expect(() => assertUuid('not-a-uuid')).toThrow(/Invalid UUID/);
    expect(() => assertUuid('')).toThrow(/Invalid UUID/);
    expect(() => assertUuid('12345')).toThrow(/Invalid UUID/);
  });

  it('rejects UUIDs with injection-style suffixes', () => {
    expect(() => assertUuid(`${VALID},other_id.eq.attacker`)).toThrow(/Invalid UUID/);
    expect(() => assertUuid(`${VALID}'`)).toThrow(/Invalid UUID/);
  });

  it('includes the field name in the error', () => {
    expect(() => assertUuid('x', 'commission_id')).toThrow(/commission_id/);
  });
});

describe('asUuid', () => {
  it('returns the string for a valid UUID', () => {
    expect(asUuid(VALID)).toBe(VALID);
  });

  it('returns null for invalid input', () => {
    expect(asUuid('not-a-uuid')).toBeNull();
    expect(asUuid(123)).toBeNull();
    expect(asUuid(null)).toBeNull();
  });
});

describe('assertSafeForOrFilter', () => {
  it('accepts UUIDs', () => {
    expect(() => assertSafeForOrFilter(VALID)).not.toThrow();
  });

  it('accepts simple alphanumeric ids', () => {
    expect(() => assertSafeForOrFilter('abc_123-def')).not.toThrow();
  });

  it('rejects commas (DSL separator)', () => {
    expect(() => assertSafeForOrFilter(`${VALID},injected`)).toThrow(/Unsafe/);
  });

  it('rejects dots (operator separator)', () => {
    expect(() => assertSafeForOrFilter(`${VALID}.eq.x`)).toThrow(/Unsafe/);
  });

  it('rejects parens, quotes, spaces', () => {
    expect(() => assertSafeForOrFilter("x'y")).toThrow(/Unsafe/);
    expect(() => assertSafeForOrFilter('x y')).toThrow(/Unsafe/);
    expect(() => assertSafeForOrFilter('(x)')).toThrow(/Unsafe/);
  });
});

describe('orEither', () => {
  it('builds the .or() filter string for a valid UUID', () => {
    expect(orEither('buyer_id', 'seller_id', VALID))
      .toBe(`buyer_id.eq.${VALID},seller_id.eq.${VALID}`);
  });

  it('throws when the value would inject extra clauses', () => {
    expect(() => orEither('buyer_id', 'seller_id', `${VALID},knitter_id.gt.0`))
      .toThrow(/Unsafe/);
  });

  it('throws on non-string values', () => {
    expect(() => orEither('a', 'b', 42)).toThrow();
    expect(() => orEither('a', 'b', null)).toThrow();
  });
});
