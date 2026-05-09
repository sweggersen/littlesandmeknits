import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { createServerSupabase } from '../../../lib/supabase';

const VALID_KEYS = new Set([
  'email_new_offer',
  'email_offer_accepted',
  'email_offer_declined',
  'email_payment_received',
  'email_project_update',
  'email_new_message',
  'email_yarn_shipped',
  'email_yarn_received',
  'email_commission_completed',
  'email_commission_delivered',
  'email_request_expired',
  'push_enabled',
]);

export const POST: APIRoute = async ({ request, cookies }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return new Response('Unauthorized', { status: 401 });

  const body = await request.json();
  const update: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(body)) {
    if (VALID_KEYS.has(key) && typeof val === 'boolean') {
      update[key] = val;
    }
  }

  if (Object.keys(update).length === 0) {
    return new Response('No valid fields', { status: 400 });
  }

  const supabase = createServerSupabase({ request, cookies });

  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ user_id: user.id, ...update }, { onConflict: 'user_id' });

  if (error) {
    console.error('Preferences save failed', error);
    return new Response('Could not save', { status: 500 });
  }

  return new Response('OK');
};
