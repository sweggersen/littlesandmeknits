import { describe, it, expect } from 'vitest';
import { hasSupabaseAuthCookie } from './auth';

describe('hasSupabaseAuthCookie', () => {
  it('detects the standard @supabase/ssr session cookie', () => {
    expect(hasSupabaseAuthCookie('sb-cftibmirzakolkcqvqsq-auth-token=base64-...')).toBe(true);
  });

  it('detects chunked session cookies (.0/.1)', () => {
    expect(hasSupabaseAuthCookie('foo=1; sb-abc-auth-token.0=part1; sb-abc-auth-token.1=part2')).toBe(true);
  });

  it('detects it among other cookies', () => {
    expect(hasSupabaseAuthCookie('st_session=1; prev_section=market; sb-x-auth-token=v')).toBe(true);
  });

  it('anonymous visitors (no header / unrelated cookies) short-circuit', () => {
    expect(hasSupabaseAuthCookie(null)).toBe(false);
    expect(hasSupabaseAuthCookie('')).toBe(false);
    expect(hasSupabaseAuthCookie('st_session=1; prev_section=lmk')).toBe(false);
  });

  it('does not false-positive on lookalike names', () => {
    // Value mentioning the name, or a name merely containing 'sb-' elsewhere.
    expect(hasSupabaseAuthCookie('theme=sb-auth-token-ish')).toBe(false);
    expect(hasSupabaseAuthCookie('xsb-abc-auth-token=v')).toBe(false);
  });
});
