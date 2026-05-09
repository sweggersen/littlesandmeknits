import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { createServerSupabase } from '../../../lib/supabase';

export const POST: APIRoute = async ({ request, cookies }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { endpoint, keys } = await request.json();
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return new Response('Invalid subscription', { status: 400 });
  }

  const supabase = createServerSupabase({ request, cookies });
  await supabase
    .from('push_subscriptions')
    .upsert(
      { user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      { onConflict: 'user_id,endpoint' },
    );

  return new Response('OK');
};
