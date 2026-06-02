// Dev-only: instantly approve a store by slug, bypassing the moderation queue.
//   POST /api/dev/approve-store with { slug } JSON body
import type { APIRoute } from 'astro';
import { env } from '../../../lib/env';
import { getCurrentUser } from '../../../lib/auth';
import { createAdminSupabase } from '../../../lib/supabase';
import { devToolsBlocked } from '../../../lib/dev-guard';

const ADMINS = ['ammon.weggersen@gmail.com', 'sam.mathias.weggersen@gmail.com'];

async function verifyAdminToken(token: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  for (const d of [now, yesterday]) {
    const day = d.toISOString().slice(0, 10);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`admin-tower-${day}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig))).slice(0, 43);
    if (token === expected) return true;
  }
  return false;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const blocked = devToolsBlocked(request);
  if (blocked) return blocked;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Service role key missing', { status: 503 });
  }

  // Allow either an admin-token (for Playwright / CI) or a logged-in admin user
  const headerToken = request.headers.get('X-Admin-Token');
  let actorId: string | null = null;
  if (headerToken) {
    const ok = await verifyAdminToken(headerToken, env.SUPABASE_SERVICE_ROLE_KEY);
    if (!ok) return new Response('Forbidden', { status: 403 });
  } else {
    const user = await getCurrentUser({ request, cookies });
    if (!user || !ADMINS.includes(user.email ?? '')) {
      return new Response('Forbidden', { status: 403 });
    }
    actorId = user.id;
  }

  const { slug } = await request.json() as { slug: string };
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
    reviewed_by: actorId,
    promo_year_one_free: isFounding,
  }).eq('id', store.id);

  // Clear any pending moderation_queue row
  await admin.from('moderation_queue').update({
    status: 'approved', decision_by: actorId, decision_at: now,
  }).eq('item_type', 'store').eq('item_id', store.id);

  // Grant store achievements to all members
  try {
    const { checkAndGrantAchievements } = await import('../../../lib/achievements');
    const { data: members } = await admin
      .from('store_members').select('user_id').eq('store_id', store.id);
    for (const m of members ?? []) {
      await checkAndGrantAchievements(admin, m.user_id, env as any);
    }
  } catch (err) {
    console.error('Store achievement grant failed', err);
  }

  return new Response(JSON.stringify({ ok: true, founding: isFounding }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
