// Section-level feature gates for the soft launch (docs/GO_LIVE_MILESTONES.md).
//
// Each marketplace/studio section can be turned OFF at runtime by setting
// `FLAG_SECTION_<NAME>` to a falsy string in the Cloudflare env — no redeploy,
// same mechanism as the KILL_* switches. When OFF: the nav pill is hidden and
// the route redirects to a "kommer snart" page.
//
// DEFAULT-ON: a section is enabled unless its flag is *explicitly* off. A
// missing flag must never blank the site — we gate deliberately, section by
// section, as each clears its milestone. (This is the opposite default of
// flags.ts `isFeatureOn`, which is default-OFF for opt-in features, so this
// lives in its own module rather than reusing that helper.)

export type Section =
  | 'brukt' | 'nytt' | 'oppdrag' | 'butikker'
  | 'profil' | 'strikkestua' | 'oppskrifter';

export const SECTIONS: Section[] = [
  'brukt', 'nytt', 'oppdrag', 'butikker', 'profil', 'strikkestua', 'oppskrifter',
];

type EnvSource = Record<string, string | undefined> | null | undefined;

const OFF_VALUES = new Set(['off', '0', 'false', 'no']);
const ON_VALUES = new Set(['on', '1', 'true', 'yes']);

// Sections not launched yet: OFF by default (routes redirect to /kommer-snart,
// nav pill hidden) until a flag EXPLICITLY turns them on — the opposite of the
// default-on below, chosen deliberately so an unlaunched section can never leak
// just because a flag wasn't set. Remove a section here (or set
// FLAG_SECTION_<NAME>=on) to launch it.
//
// NB: the prod deploy runs `wrangler deploy --config dist/server/wrangler.json`
// (the Astro-adapter-generated config), so root wrangler.jsonc `vars` do NOT
// reach runtime. To flip one on without a code change, set the runtime var in
// the Cloudflare dashboard (read via `cloudflare:workers` env here).
const UNLAUNCHED: ReadonlySet<Section> = new Set<Section>(['oppskrifter']);

function flagKey(section: Section): string {
  return `FLAG_SECTION_${section.toUpperCase()}`;
}

// Read the live Cloudflare runtime binding via a defensive dynamic import (the
// same pattern flags.ts / context.ts use). Under vitest the module doesn't
// resolve and we fall back to the passed source.
async function runtimeEnv(): Promise<Record<string, unknown>> {
  try {
    const { env } = await import('cloudflare:workers');
    return env as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isExplicitlyOff(v: unknown): boolean {
  return typeof v === 'string' && OFF_VALUES.has(v.trim().toLowerCase());
}

function isExplicitlyOn(v: unknown): boolean {
  return typeof v === 'string' && ON_VALUES.has(v.trim().toLowerCase());
}

/** Whether a section is live. Default-on, EXCEPT sections in `UNLAUNCHED`, which
 *  are default-off until `FLAG_SECTION_<NAME>` is explicitly on. An explicit off
 *  always wins. Reads the passed source (import.meta.env) + the live runtime
 *  binding (Cloudflare env). */
export async function sectionEnabled(section: Section, source?: EnvSource): Promise<boolean> {
  const key = flagKey(section);
  const rt = await runtimeEnv();
  const srcVal = source?.[key];
  const rtVal = rt[key];

  if (isExplicitlyOff(srcVal) || isExplicitlyOff(rtVal)) return false;
  if (UNLAUNCHED.has(section)) return isExplicitlyOn(srcVal) || isExplicitlyOn(rtVal);
  return true;
}

/** Batch variant — resolves the enabled state of every section at once (for
 *  nav rendering). */
export async function enabledSections(source?: EnvSource): Promise<Record<Section, boolean>> {
  const entries = await Promise.all(
    SECTIONS.map(async (s) => [s, await sectionEnabled(s, source)] as const),
  );
  return Object.fromEntries(entries) as Record<Section, boolean>;
}
