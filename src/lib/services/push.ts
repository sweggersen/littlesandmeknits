import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

// The endpoint is later POSTed to by the Worker (with a VAPID Authorization
// header) whenever the user gets a notification. Without a host allowlist a user
// could store an arbitrary URL and turn that into a blind outbound request-forgery
// primitive (arbitrary public host/port, amplified by seeding many endpoints).
// Pin it to the real browser push services (https only).
const PUSH_HOST_ALLOWLIST = [
  'fcm.googleapis.com',           // Chrome / FCM
  'android.googleapis.com',       // Chrome (legacy GCM host)
  'push.services.mozilla.com',    // Firefox (*.push.services.mozilla.com)
  'push.apple.com',               // Safari (web.push.apple.com)
  'notify.windows.com',           // Edge / WNS (*.notify.windows.com)
];

function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return PUSH_HOST_ALLOWLIST.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Save (or upsert) a Web Push subscription for the current user. */
export async function subscribePush(
  ctx: ServiceContext,
  input: { endpoint: string; p256dh: string; auth: string },
): Promise<ServiceResult<void>> {
  if (!input.endpoint || !input.p256dh || !input.auth) {
    return fail('bad_input', 'Invalid subscription');
  }
  if (!isAllowedPushEndpoint(input.endpoint)) {
    return fail('bad_input', 'Ugyldig push-endepunkt');
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
