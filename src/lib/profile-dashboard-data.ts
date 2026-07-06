// Shared data loader for the profile dashboard and its design variants
// (/profile, /profile/v2, /profile/v3, /profile/v4). Extracted verbatim from
// the original /profile/index.astro frontmatter so every variant renders the
// SAME real data and is a fair visual comparison. index.astro keeps its own
// inline copy; the variants import this.

import type { SupabaseClient } from '@supabase/supabase-js';
import { projectPhotoUrl } from './storage';
import { getUserAchievementsWithDates, ACHIEVEMENTS, ACHIEVEMENT_MAP } from './achievements';
import { getEntry } from 'astro:content';

interface DashUser {
  id: string;
  user_metadata?: { display_name?: string } | null;
}

export async function loadProfileDashboard(supabase: SupabaseClient, user: DashUser) {
  const [
    { data: profile },
    { data: listings },
    { data: projects },
    { data: myRequests },
    { data: myOffers },
    { data: unreadMessages },
    { data: purchases },
    { data: externalPatterns },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, bio, location, avatar_path, seller_tags, instagram_handle, profile_visible, role')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('listings')
      .select('id, title, price_nok, status, kind, hero_photo_path, escrow_enabled, can_meet')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('projects')
      .select('id, title, status, hero_photo_path, current_rows, target_rows, commission_offer_id, commission_offers(price_nok, commission_requests!commission_offers_request_id_fkey(title, buyer_id, profiles!commission_requests_buyer_id_fkey(display_name)))')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(6),
    supabase
      .from('commission_requests')
      .select('id, title, category, status, offer_count, budget_nok_min, budget_nok_max')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('commission_offers')
      .select('id, price_nok, turnaround_weeks, status, request_id, commission_requests!commission_offers_request_id_fkey(id, title, status)')
      .eq('knitter_id', user.id)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('marketplace_messages')
      .select('id, conversation_id')
      .is('read_at', null)
      .neq('sender_id', user.id)
      .limit(100),
    supabase
      .from('purchases')
      .select('id, pattern_slug, amount_nok, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('external_patterns')
      .select('id, title, designer, cover_path, file_path, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const allPurchases = await Promise.all(
    (purchases ?? []).map(async (p: any) => {
      const entry = await getEntry('patterns', p.pattern_slug);
      return { ...p, title: entry?.data.title.nb ?? p.pattern_slug };
    }),
  );

  const allBibliotek = externalPatterns ?? [];

  const { data: myStoreMemberships } = await supabase
    .from('store_members')
    .select('role, stores:stores!inner(id, slug, name, logo_path, status, deleted_at, verified, promo_year_one_free)')
    .eq('user_id', user.id);
  const STORE_STATUS_LABEL: Record<string, string> = {
    draft: 'Utkast', pending_review: 'Til moderering', active: 'Aktiv',
    suspended: 'Suspendert', archived: 'Slettet',
  };
  const myStores: any[] = (myStoreMemberships ?? [])
    .map((m: any) => {
      const s = m.stores;
      const isActive = s.status === 'active';
      return {
        ...s,
        my_role: m.role,
        href: isActive ? `/market/store/${s.slug}` : `/market/store/${s.slug}/admin`,
        statusLabel: STORE_STATUS_LABEL[s.status] ?? s.status,
      };
    })
    .filter((s: any) => !s.deleted_at);

  const userRole = profile?.role as string | null;
  const isAdmin = userRole === 'admin';
  const isModerator = userRole === 'moderator';
  const isStaff = isAdmin || isModerator;

  const earnedWithDates = await getUserAchievementsWithDates(supabase, user.id);
  const earnedKeys = earnedWithDates.map((e) => e.key);
  const visibleAchievements = ACHIEVEMENTS.filter((a) => isStaff || a.category !== 'moderering');
  const totalEarned = earnedKeys.length;

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const recentAchievements = earnedWithDates
    .filter((e) => e.granted_at >= sevenDaysAgo)
    .sort((a, b) => b.granted_at.localeCompare(a.granted_at))
    .slice(0, 6)
    .map((e) => {
      const a = ACHIEVEMENT_MAP.get(e.key);
      return a ? { ...a, granted_at: e.granted_at } : undefined;
    })
    .filter((a): a is NonNullable<typeof a> => a !== undefined);

  let pendingQueueCount = 0;
  if (isStaff) {
    const { count } = await supabase
      .from('moderation_queue')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'escalated']);
    pendingQueueCount = count ?? 0;
  }

  const avatarUrl = profile?.avatar_path ? projectPhotoUrl(profile.avatar_path) : null;
  const displayName = profile?.display_name ?? user.user_metadata?.display_name ?? 'Anonym';

  const allListings = listings ?? [];
  const allProjects = projects ?? [];
  const allRequests = myRequests ?? [];
  const allOffers = myOffers ?? [];
  const unreadCount = (unreadMessages ?? []).length;

  const activeProjects = allProjects.filter((p) => p.status === 'active').length;
  const pendingOffers = allOffers.filter((o) => o.status === 'pending').length;
  const acceptedOffers = allOffers.filter((o) => o.status === 'accepted').length;
  const awaitingPayment = allRequests.filter((r) => r.status === 'awaiting_payment').length;

  const subtitleParts: string[] = [];
  if (unreadCount > 0) subtitleParts.push(`${unreadCount} ulest${unreadCount === 1 ? '' : 'e'} melding${unreadCount === 1 ? '' : 'er'}`);
  if (awaitingPayment > 0) subtitleParts.push(`${awaitingPayment} venter på betaling`);
  if (acceptedOffers > 0) subtitleParts.push(`${acceptedOffers} akseptert${acceptedOffers === 1 ? '' : 'e'} tilbud`);
  if (pendingOffers > 0) subtitleParts.push(`${pendingOffers} ${pendingOffers === 1 ? 'nytt' : 'nye'} tilbud`);
  if (activeProjects > 0) subtitleParts.push(`${activeProjects} aktiv${activeProjects === 1 ? 't' : 'e'} prosjekt${activeProjects === 1 ? '' : 'er'}`);

  return {
    profile, avatarUrl, displayName,
    isAdmin, isModerator, isStaff, pendingQueueCount,
    allListings, allProjects, allRequests, allOffers,
    allPurchases, allBibliotek, myStores,
    unreadCount, activeProjects, pendingOffers, acceptedOffers, awaitingPayment,
    subtitleParts,
    recentAchievements, totalEarned, visibleAchievements,
  };
}

export type ProfileDashboardData = Awaited<ReturnType<typeof loadProfileDashboard>>;
