import { describe, it, expect } from 'vitest';
import { evaluatePreflight, type PreflightStatus } from './preflight';

// A fully-configured, launch-ready prod env.
const LIVE: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_live_abc123',
  STRIPE_WEBHOOK_SECRET: 'whsec_abc123',
  VIPPS_ENV: 'prod',
  VIPPS_CLIENT_ID: 'x', VIPPS_CLIENT_SECRET: 'x', VIPPS_SUBSCRIPTION_KEY: 'x', VIPPS_MSN: '123456',
  PUBLIC_SUPABASE_URL: 'https://cftibmirzakolkcqvqsq.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGci.service.role',
  RESEND_API_KEY: 're_abc123',
  VAPID_PRIVATE_KEY: 'x', PUBLIC_VAPID_KEY: 'x',
  SENTRY_DSN: 'https://x@sentry.io/1',
  CRON_SECRET: 'x',
};
const statusOf = (e: Record<string, string | undefined>, key: string): PreflightStatus | undefined =>
  evaluatePreflight(e).checks.find((c) => c.key === key)?.status;

describe('evaluatePreflight', () => {
  it('a fully live prod env is ready with zero fails', () => {
    const r = evaluatePreflight(LIVE);
    expect(r.ready).toBe(true);
    expect(r.counts.fail).toBe(0);
  });

  it('an empty env fails every critical rail and is not ready', () => {
    const r = evaluatePreflight({});
    expect(r.ready).toBe(false);
    expect(statusOf({}, 'STRIPE_SECRET_KEY')).toBe('fail');
    expect(statusOf({}, 'STRIPE_WEBHOOK_SECRET')).toBe('fail');
    expect(statusOf({}, 'VIPPS_ENV')).toBe('fail');
    expect(statusOf({}, 'VIPPS_CREDENTIALS')).toBe('fail');
    expect(statusOf({}, 'PUBLIC_SUPABASE_URL')).toBe('fail');
    expect(statusOf({}, 'SUPABASE_SERVICE_ROLE_KEY')).toBe('fail');
  });

  it('the sim key is a hard fail, not a pass', () => {
    const sim = { ...LIVE, STRIPE_SECRET_KEY: 'sk_simulate' };
    expect(statusOf(sim, 'STRIPE_SECRET_KEY')).toBe('fail');
    expect(evaluatePreflight(sim).ready).toBe(false);
  });

  it('a test Stripe key warns (not live money) but does not hard-fail', () => {
    expect(statusOf({ ...LIVE, STRIPE_SECRET_KEY: 'sk_test_abc' }, 'STRIPE_SECRET_KEY')).toBe('warn');
  });

  it('VIPPS_ENV=test fails — logins would hit the test bank', () => {
    expect(statusOf({ ...LIVE, VIPPS_ENV: 'test' }, 'VIPPS_ENV')).toBe('fail');
  });

  it('a localhost Supabase URL fails — a locally-built worker got deployed', () => {
    expect(statusOf({ ...LIVE, PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }, 'PUBLIC_SUPABASE_URL')).toBe('fail');
  });

  it('missing Resend/VAPID/Sentry warn (degrade) rather than fail (block)', () => {
    const e = { ...LIVE };
    delete e.RESEND_API_KEY; delete e.VAPID_PRIVATE_KEY; delete e.SENTRY_DSN;
    expect(statusOf(e, 'RESEND_API_KEY')).toBe('warn');
    expect(statusOf(e, 'VAPID_KEYS')).toBe('warn');
    expect(statusOf(e, 'SENTRY_DSN')).toBe('warn');
    expect(evaluatePreflight(e).ready).toBe(true); // warns don't block
  });

  it('an active kill-switch is surfaced as a warning with its name', () => {
    const check = evaluatePreflight({ ...LIVE, KILL_PURCHASES: 'on' }).checks.find((c) => c.key === 'KILL_SWITCHES');
    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('KILL_PURCHASES');
  });

  it('KILL_x=off is treated as inactive', () => {
    expect(statusOf({ ...LIVE, KILL_PURCHASES: 'off' }, 'KILL_SWITCHES')).toBe('ok');
  });

  it('never leaks a secret value into the report', () => {
    const report = JSON.stringify(evaluatePreflight(LIVE));
    expect(report).not.toContain('sk_live_abc123');
    expect(report).not.toContain('whsec_abc123');
    expect(report).not.toContain('re_abc123');
    expect(report).not.toContain('service.role');
  });
});
