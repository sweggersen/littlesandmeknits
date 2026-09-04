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

/** True unless `FLAG_SECTION_<NAME>` is explicitly off (in the passed source
 *  or the live runtime binding). Default-on. */
export async function sectionEnabled(section: Section, source?: EnvSource): Promise<boolean> {
  const key = flagKey(section);
  if (isExplicitlyOff(source?.[key])) return false;
  const rt = await runtimeEnv();
  if (isExplicitlyOff(rt[key])) return false;
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
