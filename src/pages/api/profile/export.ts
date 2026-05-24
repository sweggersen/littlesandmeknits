import type { APIRoute } from 'astro';
import { createServerSupabase, createAdminSupabase } from '../../../lib/supabase';
import { getCurrentUser } from '../../../lib/auth';
import { env } from 'cloudflare:workers';

// GDPR Art. 15 (right of access) + Art. 20 (data portability).
// Returns every personal datum we hold about the requester in a single
// JSON blob. Streams as a download attachment so the user can keep it.
export const GET: APIRoute = async ({ request, cookies }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return new Response('Not signed in', { status: 401 });

  const supabase = createServerSupabase({ request, cookies });
  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

  // Use the user-scoped client where possible (RLS), the admin client only
  // for tables they otherwise can't read in full (auth.users).
  const [
    profileRes,
    listingsRes,
    purchasesRes,
    favoritesRes,
    conversationsRes,
    messagesRes,
    notificationsRes,
    reviewsGivenRes,
    reviewsReceivedRes,
    storeMembersRes,
    commissionsRes,
    offersRes,
    reportsFiledRes,
    modThreadsRes,
    authUserRes,
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('listings').select('*').eq('seller_id', user.id),
    supabase.from('listings').select('*').eq('buyer_id', user.id),
    supabase.from('favorites').select('*').eq('user_id', user.id),
    supabase.from('marketplace_conversations').select('*').or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`),
    supabase.from('marketplace_messages').select('*').eq('sender_id', user.id),
    supabase.from('notifications').select('*').eq('user_id', user.id),
    supabase.from('seller_reviews').select('*').eq('reviewer_id', user.id),
    supabase.from('seller_reviews').select('*').eq('seller_id', user.id),
    supabase.from('store_members').select('*').eq('user_id', user.id),
    supabase.from('commission_requests').select('*').eq('buyer_id', user.id),
    supabase.from('commission_offers').select('*').eq('knitter_id', user.id),
    supabase.from('reports').select('*').eq('reporter_id', user.id),
    supabase.from('moderation_threads').select('*').eq('recipient_id', user.id),
    admin.auth.admin.getUserById(user.id),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    note: 'GDPR data export. Includes everything we hold about you across Littles and Me Knits, Strikketorget and Strikkestua.',
    auth: {
      id: user.id,
      email: authUserRes.data?.user?.email ?? null,
      createdAt: authUserRes.data?.user?.created_at ?? null,
      lastSignInAt: authUserRes.data?.user?.last_sign_in_at ?? null,
    },
    profile: profileRes.data ?? null,
    marketplace: {
      listingsAsSeller: listingsRes.data ?? [],
      listingsAsBuyer: purchasesRes.data ?? [],
      favorites: favoritesRes.data ?? [],
      conversations: conversationsRes.data ?? [],
      messagesSent: messagesRes.data ?? [],
      commissions: commissionsRes.data ?? [],
      commissionOffers: offersRes.data ?? [],
      storeMemberships: storeMembersRes.data ?? [],
    },
    reviews: {
      given: reviewsGivenRes.data ?? [],
      received: reviewsReceivedRes.data ?? [],
    },
    moderation: {
      reportsFiled: reportsFiledRes.data ?? [],
      threadsAsRecipient: modThreadsRes.data ?? [],
    },
    notifications: notificationsRes.data ?? [],
  };

  const body = JSON.stringify(payload, null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="littlesandme-export-${user.id}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
};
