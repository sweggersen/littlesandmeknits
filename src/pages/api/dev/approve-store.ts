// Dev-only: instantly approve a store by slug, bypassing the moderation queue.
//   POST /api/dev/approve-store with { slug } JSON body
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCurrentUser } from '../../../lib/auth';
import { createAdminSupabase } from '../../../lib/supabase';

const ADMINS = ['ammon.weggersen@gmail.com', 'sam.mathias.weggersen@gmail.com'];

export const POST: APIRoute = async ({ request, cookies }) => {
  if (import.meta.env.PROD) return new Response('Not available', { status: 403 });
  const host = new URL(request.url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.workers.dev')) {
    return new Response('Not available', { status: 403 });
  }
  const user = await getCurrentUser({ request, cookies });
  if (!user || !ADMINS.includes(user.email ?? '')) {
    return new Response('Forbidden', { status: 403 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Service role key missing', { status: 503 });
  }

  const { slug } = await request.json<{ slug: string }>();
  if (!slug) return new Response('Missing slug', { status: 400 });

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: store } = await admin.from('stores').select('id').eq('slug', slug).maybeSingle();
  if (!store) return new Response('Not found', { status: 404 });

  const { count: approvedSoFar } = await admin
    .from('stores').select('id', { count: 'exact', head: true })
    .not('approved_at', 'is', null);
  const isFounding = (approvedSoFar ?? 0) < 20;
  const now = new Date().toISOString();

  await admin.from('stores').update({
    status: 'active',
    approved_at: now,
    reviewed_at: now,
    reviewed_by: user.id,
    promo_year_one_free: isFounding,
  }).eq('id', store.id);

  // Clear any pending moderation_queue row
  await admin.from('moderation_queue').update({
    status: 'approved', decision_by: user.id, decision_at: now,
  }).eq('item_type', 'store').eq('item_id', store.id);

  return new Response(JSON.stringify({ ok: true, founding: isFounding }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
