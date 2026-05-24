import type { APIRoute } from 'astro';
import { createServerSupabase, createAdminSupabase } from '../../../lib/supabase';
import { getCurrentUser } from '../../../lib/auth';
import { env } from 'cloudflare:workers';

// GDPR Art. 17 ("right to be forgotten").
// Soft path that:
//   1. Refuses if there are pending obligations (open transactions, open
//      moderator threads).
//   2. Otherwise anonymises the profile, removes content the user fully
//      owns (favorites, drafts), and asks Supabase to delete the auth
//      user. Transaction history is retained 5 years per bokføringsloven.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return new Response('Not signed in', { status: 401 });

  const form = await request.formData();
  const confirm = form.get('confirm')?.toString();
  if (confirm !== 'SLETT') {
    return new Response('Skriv SLETT for å bekrefte', { status: 400 });
  }

  const supabase = createServerSupabase({ request, cookies });
  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. Refuse if there are pending obligations.
  const blockers: string[] = [];
  const { count: openListings } = await admin
    .from('listings').select('id', { count: 'exact', head: true })
    .eq('seller_id', user.id).in('status', ['reserved', 'shipped', 'disputed', 'frozen']);
  if ((openListings ?? 0) > 0) blockers.push(`${openListings} aktive salg`);

  const { count: pendingPurchases } = await admin
    .from('listings').select('id', { count: 'exact', head: true })
    .eq('buyer_id', user.id).in('status', ['reserved', 'shipped', 'disputed']);
  if ((pendingPurchases ?? 0) > 0) blockers.push(`${pendingPurchases} aktive kjøp`);

  const { count: openThreads } = await admin
    .from('moderation_threads').select('id', { count: 'exact', head: true })
    .eq('recipient_id', user.id).eq('status', 'open');
  if ((openThreads ?? 0) > 0) blockers.push(`${openThreads} aktive moderasjonssaker`);

  if (blockers.length) {
    return new Response(
      `Kontoen kan ikke slettes med pågående saker: ${blockers.join(', ')}. ` +
      `Fullfør disse først, eller kontakt oss på hei@littlesandmeknits.com.`,
      { status: 409 },
    );
  }

  // 2. Anonymise the profile + clear personal content.
  const anonName = `slettet-${user.id.slice(0, 8)}`;
  await admin.from('profiles').update({
    display_name: anonName,
    avatar_path: null,
    bio: null,
    instagram_handle: null,
    location: null,
    seller_tags: null,
    deleted_at: new Date().toISOString(),
  }).eq('id', user.id);

  // Wipe purely-personal artifacts.
  await admin.from('favorites').delete().eq('user_id', user.id);
  await admin.from('notifications').delete().eq('user_id', user.id);
  await admin.from('notification_preferences').delete().eq('user_id', user.id);

  // Archive any draft listings.
  await admin.from('listings').update({ status: 'removed' })
    .eq('seller_id', user.id).in('status', ['draft', 'pending_review', 'active']);

  // 3. Delete the auth user (revokes all sessions, removes login).
  await admin.auth.admin.deleteUser(user.id);

  // 4. Clear cookies + redirect.
  cookies.delete('sb-access-token', { path: '/' });
  cookies.delete('sb-refresh-token', { path: '/' });
  cookies.delete('st_session', { path: '/' });
  return redirect('/?deleted=1', 303);
};
