import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

/** Save (or upsert) a Web Push subscription for the current user. */
export async function subscribePush(
  ctx: ServiceContext,
  input: { endpoint: string; p256dh: string; auth: string },
): Promise<ServiceResult<void>> {
  if (!input.endpoint || !input.p256dh || !input.auth) {
    return fail('bad_input', 'Invalid subscription');
  }
  const { error } = await ctx.supabase
    .from('push_subscriptions')
    .upsert(
      { user_id: ctx.user.id, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth },
      { onConflict: 'user_id,endpoint' },
    );
  if (error) {
    console.error('subscribePush failed', error);
    return fail('server_error', error.message);
  }
  return ok(undefined);
}

/** Remove the user's subscription for a specific browser endpoint. */
export async function unsubscribePush(
  ctx: ServiceContext,
  input: { endpoint: string },
): Promise<ServiceResult<void>> {
  if (!input.endpoint) return fail('bad_input', 'Missing endpoint');
  const { error } = await ctx.supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', ctx.user.id)
    .eq('endpoint', input.endpoint);
  if (error) {
    console.error('unsubscribePush failed', error);
    return fail('server_error', error.message);
  }
  return ok(undefined);
}
