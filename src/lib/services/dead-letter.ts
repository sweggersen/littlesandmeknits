import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

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
  ctx: Pick<ServiceContext, 'admin' | 'user'>,
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
    });
  } catch (e) {
    console.error('[dead-letter] insert failed (giving up)', {
      service: input.service,
      original_error: message,
      insert_error: e instanceof Error ? e.message : e,
    });
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
