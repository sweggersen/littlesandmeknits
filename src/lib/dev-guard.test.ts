import { describe, it, expect, vi } from 'vitest';

// dev-guard.ts imports ./env (-> cloudflare:workers). Stub it so the module
// loads under vitest; we only exercise the pure decision function.
vi.mock('cloudflare:workers', () => ({ env: {} }));

import { isDevToolsAllowed } from './dev-guard';

describe('isDevToolsAllowed', () => {
  it('always blocks on a production build, even on localhost', () => {
    expect(isDevToolsAllowed({ isProd: true, host: 'localhost', devToolsFlag: 'enabled' })).toBe(false);
    expect(isDevToolsAllowed({ isProd: true, host: '127.0.0.1', devToolsFlag: undefined })).toBe(false);
  });

  it('allows localhost on a non-prod build', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(isDevToolsAllowed({ isProd: false, host, devToolsFlag: undefined })).toBe(true);
    }
  });

  it('blocks a *.workers.dev preview by default (the old allowance is gone)', () => {
    expect(isDevToolsAllowed({
      isProd: false, host: 'littlesandme-pr-7.smth.workers.dev', devToolsFlag: undefined,
    })).toBe(false);
  });

  it('allows a non-local host ONLY with explicit DEV_TOOLS=enabled', () => {
    const host = 'preview.littlesandmeknits.com';
    expect(isDevToolsAllowed({ isProd: false, host, devToolsFlag: undefined })).toBe(false);
    expect(isDevToolsAllowed({ isProd: false, host, devToolsFlag: 'no' })).toBe(false);
    expect(isDevToolsAllowed({ isProd: false, host, devToolsFlag: 'enabled' })).toBe(true);
  });

  it('does not treat a workers.dev host as special when the flag is set or not', () => {
    const host = 'evil.workers.dev';
    expect(isDevToolsAllowed({ isProd: false, host, devToolsFlag: undefined })).toBe(false);
    expect(isDevToolsAllowed({ isProd: false, host, devToolsFlag: 'enabled' })).toBe(true);
  });
});
