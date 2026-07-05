import { describe, it, expect } from 'vitest';
import { safeInternalPath } from './auth';

const FB = '/studio';

describe('safeInternalPath (open-redirect guard)', () => {
  it('accepts a clean same-origin path', () => {
    expect(safeInternalPath('/market/listing/abc', FB)).toBe('/market/listing/abc');
    expect(safeInternalPath('/', FB)).toBe('/');
    expect(safeInternalPath('/market?next=x&y=1', FB)).toBe('/market?next=x&y=1');
  });

  it('falls back on empty / missing input', () => {
    expect(safeInternalPath(undefined, FB)).toBe(FB);
    expect(safeInternalPath(null, FB)).toBe(FB);
    expect(safeInternalPath('', FB)).toBe(FB);
  });

  it('rejects protocol-relative //host', () => {
    expect(safeInternalPath('//evil.com', FB)).toBe(FB);
    expect(safeInternalPath('//evil.com/path', FB)).toBe(FB);
  });

  it('rejects the backslash bypass /\\host (browsers normalise \\ to /)', () => {
    expect(safeInternalPath('/\\evil.com', FB)).toBe(FB);
    expect(safeInternalPath('/\\/evil.com', FB)).toBe(FB);
  });

  it('rejects absolute URLs and schemes', () => {
    expect(safeInternalPath('https://evil.com', FB)).toBe(FB);
    expect(safeInternalPath('http://evil.com', FB)).toBe(FB);
    expect(safeInternalPath('javascript:alert(1)', FB)).toBe(FB);
    expect(safeInternalPath('mailto:x@y.z', FB)).toBe(FB);
  });

  it('rejects paths not starting with a slash', () => {
    expect(safeInternalPath('market/listing', FB)).toBe(FB);
    expect(safeInternalPath('evil.com', FB)).toBe(FB);
  });

  it('rejects whitespace / control-char smuggling', () => {
    expect(safeInternalPath('/foo\r\nSet-Cookie: x=1', FB)).toBe(FB);
    expect(safeInternalPath('/foo bar', FB)).toBe(FB);
    expect(safeInternalPath('/foo\tbar', FB)).toBe(FB);
  });
});
