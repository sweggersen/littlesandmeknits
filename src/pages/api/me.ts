import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../lib/auth';
import { createServerSupabase } from '../../lib/supabase';

export const GET: APIRoute = async ({ request, cookies }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) {
    return new Response(JSON.stringify({ user: null }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
    });
  }

  const supabase = createServerSupabase({ request, cookies });
  const [{ data: profile }, { count: unreadCount }, { count: notifCount }] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, avatar_path')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('marketplace_messages')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .neq('sender_id', user.id),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null),
  ]);

  return new Response(
    JSON.stringify({
      user: {
        id: user.id,
        email: user.email,
        display_name: profile?.display_name ?? null,
        avatar_path: profile?.avatar_path ?? null,
        unread: unreadCount ?? 0,
        notifications: notifCount ?? 0,
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
    }
  );
};
