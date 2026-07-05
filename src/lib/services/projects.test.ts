import { describe, it, expect } from 'vitest';
import { safeProgressReturn } from './projects';

const FALLBACK = '/studio/projects/proj-1';

describe('safeProgressReturn (P2.1 open-redirect guard)', () => {
  it('honours a valid commission detail path', () => {
    expect(safeProgressReturn('/market/commissions/abc-123', FALLBACK))
      .toBe('/market/commissions/abc-123');
  });

  it('allows an optional trailing slash', () => {
    expect(safeProgressReturn('/market/commissions/abc-123/', FALLBACK))
      .toBe('/market/commissions/abc-123/');
  });

  it('falls back when returnTo is undefined', () => {
    expect(safeProgressReturn(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('rejects an absolute external URL', () => {
    expect(safeProgressReturn('https://evil.example/market/commissions/x', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a protocol-relative URL', () => {
    expect(safeProgressReturn('//evil.example', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a different internal path', () => {
    expect(safeProgressReturn('/admin/users', FALLBACK)).toBe(FALLBACK);
    expect(safeProgressReturn('/market/listing/abc', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a commission path with an injected query or fragment', () => {
    expect(safeProgressReturn('/market/commissions/x?next=//evil', FALLBACK)).toBe(FALLBACK);
    expect(safeProgressReturn('/market/commissions/x#/../admin', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a nested path pretending to be a commission', () => {
    expect(safeProgressReturn('/market/commissions/x/../../admin', FALLBACK)).toBe(FALLBACK);
  });
});
