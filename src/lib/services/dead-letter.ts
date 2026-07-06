import type { ServiceContext, ServiceResult } from './types';
import { ok, fail, ensureStaff } from './types';
import { log } from '../log';
import { captureException } from '../observability';
import { createNotification } from '../notify';

/** Env needed to push/email the alert. Optional — without it the in-app
 *  notification still lands (admins see it in the bell), just not on a phone. */
type AlertEnv = Parameters<typeof createNotification>[2];

export type DeadLetterDomain = 'marketplace' | 'studio' | 'platform';

/** Derive the routing domain from a service identifier. Conventional prefixes
 *  (`listings.*`, `commissions.*`, `webhook.*`, ...) go to 'marketplace';
 *  `patterns.*` / `projects.*` go to 'studio'; everything else is 'platform'.
 *  See supabase/migrations/0076_dead_letter_domain.sql for the canonical list. */
export function domainFromService(service: string): DeadLetterDomain {
  const prefix = service.split('.', 1)[0];
  if (['listings', 'commissions', 'conversations', 'refunds', 'disputes', 'payouts', 'webhook', 'stores'].includes(prefix)) {
    return 'marketplace';
  }
  if (['patterns', 'projects'].includes(prefix)) return 'studio';
  return 'platform';
}

export interface DeadLetterInput {
  /** Where the failure originated. Convention: `<service-file>.<function>`. */
  service: string;
  /** Sanitised inputs / IDs the support team needs to retrace. No raw PII. */
  context?: Record<string, unknown>;
  /** Short error message. Full stacks belong in worker logs. */
  error: unknown;
}

/** Record a commerce-path failure that can't be rolled back but mustn't
 *  vanish. Always uses the admin client so the write goes through even
 *  if the original ctx's user-bound client is in a weird state.
 *
 *  Best-effort: if even the dead-letter insert fails, we log to the
 *  worker console and return — there's no third layer of recovery. */
export async function recordDeadLetter(
  // user is optional because some callers (Stripe webhook, cron) don't
  // have a session-bound actor — they record on behalf of "the system".
  // env is optional: when present the admin alert also pushes/emails, so a
  // money-path failure reaches a phone, not just the in-app bell.
  ctx: { admin: ServiceContext['admin']; user?: ServiceContext['user'] | undefined; env?: AlertEnv },
  input: DeadLetterInput,
): Promise<void> {
  const message = input.error instanceof Error
    ? input.error.message
    : typeof input.error === 'string'
      ? input.error
      : JSON.stringify(input.error);

  try {
    await ctx.admin.from('dead_letter_events').insert({
      service: input.service,
      user_id: ctx.user?.id ?? null,
      context: (input.context ?? {}) as Record<string, unknown> as never,
      error: message.slice(0, 2000),
      domain: domainFromService(input.service),
    } as never);
  } catch (e) {
    log.error('dead_letter.insert_failed', {
      service: input.service,
      original_error: message,
      error: e,
    });
  }

  // Mirror to Sentry (no-op unless SENTRY_DSN is set). Best-effort: every
  // dead-letter is, by definition, something support needs to see — so it
  // should also page our error tracker, not just sit in a table.
  await captureException(input.error, {
    service: input.service,
    extra: input.context as Record<string, unknown> | undefined,
  });

  // Proactively alert admins so a money-path failure can't sit unseen in the
  // table until someone happens to open /admin/dead-letters. Best-effort:
  // alerting must NEVER break (or recurse into) the dead-letter path, so all
  // failures here are swallowed.
  await alertAdmins(ctx, input.service, message);
}

/** Notify every admin that a commerce failure was recorded. In-app always (no
 *  env needed); push/email too when env carries the Resend/VAPID keys.
 *  Swallows everything — never throws, never re-records a dead-letter. */
async function alertAdmins(
  ctx: { admin: ServiceContext['admin']; env?: AlertEnv },
  service: string,
  message: string,
): Promise<void> {
  try {
    const { data: admins } = await ctx.admin
      .from('profiles').select('id').eq('role', 'admin');
    for (const a of admins ?? []) {
      await createNotification(ctx.admin, {
        userId: (a as { id: string }).id,
        type: 'system_alert',
        title: 'Systemvarsel: en hendelse feilet',
        body: `${service}: ${message.slice(0, 200)}`,
        url: '/admin/dead-letters',
      }, ctx.env);
    }
  } catch (e) {
    log.error('dead_letter.alert_failed', { service, error: e });
  }
}

/** Admin-only: mark a dead-letter event resolved with an optional note.
 *  Role check is enforced by RLS — the dead_letter_events UPDATE policy
 *  requires admin/moderator on the calling profile. */
export async function resolveDeadLetter(
  ctx: ServiceContext,
  input: { eventId: string; note: string | null },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.eventId) return fail('bad_input', 'Missing event id');
  // Explicit authorization (defense in depth). This is the only admin service
  // that relied SOLELY on the dead_letter_events UPDATE RLS being staff-only; an
  // accidental RLS loosening would have silently opened it.
  const denied = await ensureStaff(ctx);
  if (denied) return denied;
  const { error } = await ctx.supabase
    .from('dead_letter_events')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: ctx.user.id,
      resolution_note: input.note,
    })
    .eq('id', input.eventId);
  if (error) return fail('server_error', error.message);
  return ok({ redirect: '/admin/dead-letters' });
}
