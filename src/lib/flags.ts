// Runtime kill-switches + feature flags (june26.md §1.4).
//
// A kill-switch lets us stop a class of money movement *without a code
// deploy*: flip the corresponding env var in the Cloudflare dashboard (or
// `wrangler secret put` / `[vars]`) and the next request is blocked. This is
// the break-glass for "Stripe is misbehaving / we shipped a money bug" — turn
// it off, investigate, turn it back on. See docs/INCIDENT_RUNBOOK.md.
//
// Read order (engaged if ANY source is truthy):
//   1. an explicitly passed source (ctx.env in services, or a test stub)
//   2. the live Cloudflare runtime binding — the authoritative source in
//      prod, and the one that flips without a redeploy
// We read the runtime binding via a defensive dynamic import (the same
// pattern context.ts and cron/run.ts use). A static `import ... from
// 'cloudflare:workers'` is reserved for src/lib/env.ts and would also throw
// under vitest (the module doesn't resolve there); the dynamic form degrades
// to the passed source instead, keeping the unit suite green.

import type { ServiceResult } from './services/types';
import { fail } from './services/types';

export type KillSwitch = 'purchases' | 'payouts' | 'commissions';

const KILL_ENV: Record<KillSwitch, string> = {
  purchases: 'KILL_PURCHASES',
  payouts: 'KILL_PAYOUTS',
  commissions: 'KILL_COMMISSIONS',
};

// User-facing copy when a switch is engaged. Norwegian, no em-dash. The
// payouts message reassures the buyer their held funds are safe.
const KILL_MESSAGE: Record<KillSwitch, string> = {
  purchases: 'Kjøp er midlertidig satt på pause. Prøv igjen om en liten stund.',
  payouts: 'Utbetalinger er midlertidig satt på pause. Beløpet ditt holdes trygt og frigis så snart tjenesten er tilbake.',
  commissions: 'Bestillinger («Strikk for meg») er midlertidig satt på pause. Prøv igjen om en liten stund.',
};

type EnvSource = Record<string, string | undefined> | null | undefined;

function truthy(v: unknown): boolean {
  return typeof v === 'string' && ['on', '1', 'true', 'yes'].includes(v.trim().toLowerCase());
}

async function runtimeEnv(): Promise<Record<string, unknown>> {
  try {
    const { env } = await import('cloudflare:workers');
    return env as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function readFlag(source: EnvSource, key: string): Promise<boolean> {
  if (truthy(source?.[key])) return true;
  const rt = await runtimeEnv();
  return truthy(rt[key]);
}

/** True when the given kill-switch is engaged. */
export async function isKilled(sw: KillSwitch, source?: EnvSource): Promise<boolean> {
  return readFlag(source, KILL_ENV[sw]);
}

/** Generic feature flag, ON when env `FLAG_<NAME>` is truthy. */
export async function isFeatureOn(name: string, source?: EnvSource): Promise<boolean> {
  return readFlag(source, `FLAG_${name.toUpperCase()}`);
}

/**
 * Service guard: returns a `fail('service_unavailable', ...)` ServiceResult if
 * any of the listed switches is engaged, otherwise null. Drop it at the top of
 * a money-moving service before any Stripe call:
 *
 *   const blocked = await killGuard(['purchases'], ctx.env);
 *   if (blocked) return blocked;
 */
export async function killGuard(
  switches: KillSwitch[],
  source?: EnvSource,
): Promise<ServiceResult<never> | null> {
  for (const sw of switches) {
    if (await isKilled(sw, source)) return fail('service_unavailable', KILL_MESSAGE[sw]);
  }
  return null;
}
