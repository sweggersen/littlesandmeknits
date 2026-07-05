import { describe, it, expect } from 'vitest';
import { resolveUserEmail, extractBearerToken } from './auth';

describe('resolveUserEmail', () => {
  const SYNTH = 'vipps-abc123@vipps.users.littlesandmeknits.com';

  it('prefers the real Vipps email from user_metadata over the synthetic auth email', () => {
    expect(resolveUserEmail({ email: SYNTH, user_metadata: { vipps_email: 'kari@gmail.com' } }))
      .toBe('kari@gmail.com');
  });

  it('uses a real auth email when there is no synthetic placeholder', () => {
    expect(resolveUserEmail({ email: 'sam@example.com', user_metadata: {} })).toBe('sam@example.com');
  });

  it('returns null for a Vipps user with only the synthetic email (no real one)', () => {
    expect(resolveUserEmail({ email: SYNTH, user_metadata: {} })).toBeNull();
    expect(resolveUserEmail({ email: SYNTH, user_metadata: { vipps_email: null } })).toBeNull();
  });

  it('never returns the synthetic address even if it sneaks into vipps_email', () => {
    expect(resolveUserEmail({ email: SYNTH, user_metadata: { vipps_email: SYNTH } })).toBeNull();
  });

  it('handles null / missing users', () => {
    expect(resolveUserEmail(null)).toBeNull();
    expect(resolveUserEmail(undefined)).toBeNull();
    expect(resolveUserEmail({ email: null })).toBeNull();
  });
});

describe('extractBearerToken', () => {
  it('pulls the token from an Authorization header', () => {
    expect(extractBearerToken(new Request('https://x', { headers: { Authorization: 'Bearer abc.def' } }))).toBe('abc.def');
  });
  it('returns null without a Bearer header', () => {
    expect(extractBearerToken(new Request('https://x'))).toBeNull();
  });
});
