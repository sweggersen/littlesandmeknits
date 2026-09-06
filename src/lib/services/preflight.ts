// Launch preflight — answers "is prod actually configured to take real money and
// real logins?" by inspecting the runtime env and classifying each required
// secret. It reports PRESENCE + CLASSIFICATION only (live vs test/sim, prod vs
// local, set vs missing) and NEVER a secret value, so the report itself is safe
// to render in the admin UI.
//
// Why this exists: several prod secrets fail *silently* when unset — a missing
// RESEND_API_KEY just no-ops the welcome email, a test Stripe key quietly moves
// no money, VIPPS_ENV=test silently logs everyone into the test bank. This turns
// those silent no-ops into one loud, greppable checklist before go-live.
//
// `evaluatePreflight` is pure (env-record in, report out) so it unit-tests
// without a worker runtime; `launchPreflight` is the admin-gated service wrapper.

import { type ServiceContext, type ServiceResult, ok, ensureAdmin } from './types';

export type PreflightStatus = 'ok' | 'warn' | 'fail';

export interface PreflightCheck {
  key: string;
  label: string;
  group: string;
  status: PreflightStatus;
  detail: string;
}

export interface PreflightReport {
  /** True when no check is `fail` — i.e. nothing that would break real money or logins. */
  ready: boolean;
  counts: { ok: number; warn: number; fail: number };
  checks: PreflightCheck[];
}

type Env = Record<string, string | undefined>;
const present = (v?: string) => typeof v === 'string' && v.trim().length > 0;
const on = (v?: string) => present(v) && !['off', '0', 'false', 'no'].includes(v!.trim().toLowerCase());

const G_STRIPE = 'Betaling (Stripe)';
const G_VIPPS = 'Innlogging (Vipps)';
const G_DB = 'Database';
const G_NOTIF = 'Varsler og e-post';
const G_OPS = 'Drift og feilsporing';
const G_KILL = 'Kill-brytere';

/** Pure: classify the launch-critical env into a report. No secret values leave. */
export function evaluatePreflight(e: Env): PreflightReport {
  const checks: PreflightCheck[] = [];
  const add = (c: PreflightCheck) => checks.push(c);

  // ── Stripe: the money rail ──────────────────────────────────────────────
  const sk = e.STRIPE_SECRET_KEY;
  add({
    key: 'STRIPE_SECRET_KEY', label: 'Stripe secret key', group: G_STRIPE,
    ...(!present(sk) ? { status: 'fail' as const, detail: 'Mangler. Alle betalinger feiler (createStripe() kaster i prod).' }
      : sk === 'sk_simulate' ? { status: 'fail' as const, detail: 'Er simuleringsnøkkelen (sk_simulate). Betalinger er falske, ingen ekte penger flyttes.' }
      : sk!.startsWith('sk_test_') ? { status: 'warn' as const, detail: 'Testnøkkel (sk_test_). Bra for test-smoke, men ekte penger flyttes ikke.' }
      : sk!.startsWith('sk_live_') ? { status: 'ok' as const, detail: 'Live-nøkkel (sk_live_) er satt.' }
      : { status: 'warn' as const, detail: 'Uventet nøkkelformat (verken sk_live_/sk_test_/sk_simulate).' }),
  });
  const wh = e.STRIPE_WEBHOOK_SECRET;
  add({
    key: 'STRIPE_WEBHOOK_SECRET', label: 'Stripe webhook-signeringshemmelighet', group: G_STRIPE,
    ...(!present(wh) ? { status: 'fail' as const, detail: 'Mangler. Webhooken avviser Stripe-hendelser, så kjøp fullføres aldri.' }
      : wh!.startsWith('whsec_') ? { status: 'ok' as const, detail: 'Satt (whsec_).' }
      : { status: 'warn' as const, detail: 'Uventet format (forventet whsec_).' }),
  });

  // ── Vipps: the login rail (blocks every authed section) ──────────────────
  const venv = e.VIPPS_ENV;
  add({
    key: 'VIPPS_ENV', label: 'Vipps-miljø', group: G_VIPPS,
    ...(venv === 'prod' ? { status: 'ok' as const, detail: 'prod.' }
      : { status: 'fail' as const, detail: `Er "${present(venv) ? venv : '(usatt)'}", ikke "prod". Innlogging går mot testbanken.` }),
  });
  const vippsCreds = ['VIPPS_CLIENT_ID', 'VIPPS_CLIENT_SECRET', 'VIPPS_SUBSCRIPTION_KEY', 'VIPPS_MSN'];
  const missingVipps = vippsCreds.filter((k) => !present(e[k]));
  add({
    key: 'VIPPS_CREDENTIALS', label: 'Vipps-legitimasjon (client id/secret/sub-key/MSN)', group: G_VIPPS,
    ...(missingVipps.length === 0 ? { status: 'ok' as const, detail: 'Alle fire satt.' }
      : { status: 'fail' as const, detail: `Mangler: ${missingVipps.join(', ')}. Innlogging blokkeres.` }),
  });

  // ── Database ─────────────────────────────────────────────────────────────
  const url = e.PUBLIC_SUPABASE_URL;
  add({
    key: 'PUBLIC_SUPABASE_URL', label: 'Supabase-URL (bakt inn i bundelen)', group: G_DB,
    ...(!present(url) ? { status: 'fail' as const, detail: 'Mangler. Alle Supabase-sider 500-er (2026-06-15-utfallet).' }
      : /localhost|127\.0\.0\.1/.test(url!) ? { status: 'fail' as const, detail: 'Peker på lokal database. En lokalt bygd worker ble deployet.' }
      : { status: 'ok' as const, detail: 'Peker på ekstern Supabase.' }),
  });
  add({
    key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase service-role-nøkkel', group: G_DB,
    ...(present(e.SUPABASE_SERVICE_ROLE_KEY) ? { status: 'ok' as const, detail: 'Satt (varsler, webhook-bivirkninger, admin-verktøy virker).' }
      : { status: 'fail' as const, detail: 'Mangler. Varsler og webhook-admin-effekter no-op-er stille.' }),
  });

  // ── Notifications + email ────────────────────────────────────────────────
  add({
    key: 'RESEND_API_KEY', label: 'Resend API-nøkkel (e-post)', group: G_NOTIF,
    ...(!present(e.RESEND_API_KEY) ? { status: 'warn' as const, detail: 'Mangler. Velkomst-e-post og kvitteringer sendes ikke.' }
      : e.RESEND_API_KEY!.startsWith('re_') ? { status: 'ok' as const, detail: 'Satt (re_). Husk verifisert sendedomene.' }
      : { status: 'warn' as const, detail: 'Uventet format (forventet re_).' }),
  });
  const vapid = present(e.VAPID_PRIVATE_KEY) && present(e.PUBLIC_VAPID_KEY);
  add({
    key: 'VAPID_KEYS', label: 'VAPID-nøkler (push-varsler)', group: G_NOTIF,
    ...(vapid ? { status: 'ok' as const, detail: 'Både privat + offentlig nøkkel satt.' }
      : { status: 'warn' as const, detail: 'Mangler. Push-varsler i nettleseren no-op-er.' }),
  });

  // ── Ops + error tracking ─────────────────────────────────────────────────
  add({
    key: 'SENTRY_DSN', label: 'Sentry DSN (feilsporing)', group: G_OPS,
    ...(present(e.SENTRY_DSN) ? { status: 'ok' as const, detail: 'Satt. SSR-500-er rapporteres.' }
      : { status: 'warn' as const, detail: 'Ikke satt. Anbefalt: uten den er SSR-500-er usynlige.' }),
  });
  add({
    key: 'CRON_SECRET', label: 'Cron-hemmelighet', group: G_OPS,
    ...(present(e.CRON_SECRET) ? { status: 'ok' as const, detail: 'Satt. /api/cron/run er beskyttet.' }
      : { status: 'warn' as const, detail: 'Mangler. Cron-endepunktet er ubeskyttet.' }),
  });

  // ── Kill-switches: flag an accidental launch-while-paused ────────────────
  const killsOn = Object.keys(e).filter((k) => k.startsWith('KILL_') && on(e[k]));
  add({
    key: 'KILL_SWITCHES', label: 'Kill-brytere', group: G_KILL,
    ...(killsOn.length === 0 ? { status: 'ok' as const, detail: 'Ingen aktive. Handel er åpen.' }
      : { status: 'warn' as const, detail: `AKTIVE (pauser handel): ${killsOn.join(', ')}. Slå av før lansering hvis utilsiktet.` }),
  });

  const counts = { ok: 0, warn: 0, fail: 0 };
  for (const c of checks) counts[c.status]++;
  return { ready: counts.fail === 0, counts, checks };
}

/**
 * Live probe: presence of SUPABASE_SERVICE_ROLE_KEY isn't proof it's valid,
 * unrotated, or that the DB is reachable. A trivial service-role read confirms
 * all three — the one thing env inspection can't.
 */
async function probeDatabase(ctx: ServiceContext): Promise<PreflightCheck> {
  try {
    const { error } = await ctx.admin.from('profiles').select('id').limit(1);
    if (error) {
      return { key: 'DB_REACHABLE', label: 'Database når frem (service-role)', group: G_DB, status: 'fail',
        detail: `Service-role-spørring feilet (${error.code || 'ukjent'}). Nøkkelen kan være feil/rotert eller DB utilgjengelig.` };
    }
    return { key: 'DB_REACHABLE', label: 'Database når frem (service-role)', group: G_DB, status: 'ok',
      detail: 'En service-role-lesing lyktes. Nøkkelen virker og DB svarer.' };
  } catch {
    return { key: 'DB_REACHABLE', label: 'Database når frem (service-role)', group: G_DB, status: 'fail',
      detail: 'Kunne ikke nå databasen i det hele tatt.' };
  }
}

/**
 * Admin-gated wrapper. Caller passes the real runtime env (from lib/env).
 * Runs the pure env checks, then appends a live DB-reachability probe.
 */
export async function launchPreflight(ctx: ServiceContext, e: Env): Promise<ServiceResult<PreflightReport>> {
  const denied = await ensureAdmin(ctx);
  if (denied) return denied;
  const report = evaluatePreflight(e);
  const probe = await probeDatabase(ctx);
  report.checks.push(probe);
  report.counts[probe.status]++;
  report.ready = report.counts.fail === 0;
  return ok(report);
}
