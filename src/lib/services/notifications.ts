import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

export async function deleteNotification(
  ctx: ServiceContext,
  input: { notificationId: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (!input.notificationId) return fail('bad_input', 'Missing id');
  await ctx.supabase.from('notifications').delete().eq('id', input.notificationId);
  return ok({ redirect: '/varsler' });
}

const VALID_KEYS = new Set([
  'email_new_offer', 'email_offer_accepted', 'email_offer_declined',
  'email_payment_received', 'email_project_update', 'email_new_message',
  'email_yarn_shipped', 'email_yarn_received',
  'email_commission_completed', 'email_commission_delivered',
  'email_request_expired', 'push_enabled',
]);

export async function updatePreferences(
  ctx: ServiceContext,
  input: Record<string, unknown>,
): Promise<ServiceResult<void>> {
  const update: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(input)) {
    if (VALID_KEYS.has(key) && typeof val === 'boolean') {
      update[key] = val;
    }
  }

  if (Object.keys(update).length === 0) return fail('bad_input', 'No valid fields');

  const { error } = await ctx.supabase
    .from('notification_preferences')
    .upsert({ user_id: ctx.user.id, ...update }, { onConflict: 'user_id' });

  if (error) {
    console.error('Preferences save failed', error);
    return fail('server_error', 'Could not save');
  }

  return ok(undefined as void);
}

export async function markAllRead(
  ctx: ServiceContext,
  input: { referer?: string },
): Promise<ServiceResult<{ redirect: string }>> {
  await ctx.supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', ctx.user.id)
    .is('read_at', null);

  const referer = input.referer ?? '/varsler';
  const safeNext = referer.startsWith('/') && !referer.startsWith('//') ? referer : '/varsler';
  return ok({ redirect: safeNext });
}
