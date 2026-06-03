import { describe, it, expect } from 'vitest';
import { isKilled, isFeatureOn, killGuard } from './flags';

// These exercise the passed-source path (ctx.env / test stub). The runtime
// cloudflare:workers binding is unavailable under vitest, so runtimeEnv()
// degrades to {} and the source is authoritative — which is exactly how a
// service call resolves the switch in a test.

describe('isKilled', () => {
  it('is false when the var is absent', async () => {
    expect(await isKilled('purchases', {})).toBe(false);
  });

  it('engages on truthy spellings, case/space-insensitive', async () => {
    for (const v of ['on', 'ON', ' on ', '1', 'true', 'YES']) {
      expect(await isKilled('purchases', { KILL_PURCHASES: v })).toBe(true);
    }
  });

  it('stays off for falsey/garbage values', async () => {
    for (const v of ['off', '0', 'false', 'no', '', 'maybe']) {
      expect(await isKilled('purchases', { KILL_PURCHASES: v })).toBe(false);
    }
  });

  it('reads the switch-specific var only', async () => {
    expect(await isKilled('payouts', { KILL_PURCHASES: 'on' })).toBe(false);
    expect(await isKilled('payouts', { KILL_PAYOUTS: 'on' })).toBe(true);
    expect(await isKilled('commissions', { KILL_COMMISSIONS: 'on' })).toBe(true);
  });
});

describe('isFeatureOn', () => {
  it('maps name -> FLAG_<UPPER>', async () => {
    expect(await isFeatureOn('new_checkout', { FLAG_NEW_CHECKOUT: 'on' })).toBe(true);
    expect(await isFeatureOn('new_checkout', {})).toBe(false);
  });
});

describe('killGuard', () => {
  it('returns null when all switches are clear', async () => {
    expect(await killGuard(['purchases', 'payouts'], {})).toBeNull();
  });

  it('returns a 503-mapped service_unavailable fail when engaged', async () => {
    const r = await killGuard(['purchases'], { KILL_PURCHASES: 'on' });
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(false);
    if (!r!.ok) {
      expect(r!.code).toBe('service_unavailable');
      expect(r!.message).toMatch(/pause/i);
      // No em-dash in user-facing Norwegian copy.
      expect(r!.message).not.toContain('—');
    }
  });

  it('blocks if ANY listed switch is engaged (payCommission guards both)', async () => {
    const r = await killGuard(['purchases', 'commissions'], { KILL_COMMISSIONS: 'on' });
    expect(r?.ok).toBe(false);
  });

  it('short-circuits on the first engaged switch', async () => {
    const r = await killGuard(['payouts', 'purchases'], { KILL_PAYOUTS: 'on', KILL_PURCHASES: 'on' });
    if (r && !r.ok) expect(r.message).toMatch(/Utbetalinger/);
  });
});
