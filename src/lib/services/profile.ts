import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../storage';

const VALID_LANGS = new Set(['nb', 'en']);
const VALID_TAGS = new Set(['knitter', 'sells_pre_loved', 'sells_ready_made', 'open_for_requests', 'dyer']);

function cleanHandle(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@+/, '');
  if (!trimmed || !/^[A-Za-z0-9._]{1,30}$/.test(trimmed)) return null;
  return trimmed;
}

export async function editProfile(
  ctx: ServiceContext,
  input: {
    displayName?: string; bio?: string; location?: string;
    instagramHandle?: string; language?: string;
    sellerTags: string[]; profileVisible: boolean;
    avatar?: File | null;
  },
): Promise<ServiceResult<{ redirect: string; language: string | null }>> {
  const displayName = input.displayName?.trim().slice(0, 60) || null;
  const bio = input.bio?.trim().slice(0, 500) || null;
  const location = input.location?.trim().slice(0, 100) || null;
  const instagram = cleanHandle(input.instagramHandle);
  const language = input.language && VALID_LANGS.has(input.language) ? input.language : null;
  const sellerTags = input.sellerTags.filter((t) => VALID_TAGS.has(t));

  let avatarPath: string | undefined;
  if (input.avatar instanceof File && input.avatar.size > 0) {
    const ext = input.avatar.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `avatars/${ctx.user.id}.${ext}`;
    const { error: uploadError } = await ctx.supabase.storage
      .from('projects').upload(path, input.avatar, { upsert: true, contentType: input.avatar.type });
    if (!uploadError) avatarPath = path;
  }

  const profileUpdate: Record<string, any> = {
    display_name: displayName, bio, location,
    instagram_handle: instagram, seller_tags: sellerTags,
    profile_visible: input.profileVisible,
  };
  if (avatarPath) profileUpdate.avatar_path = avatarPath;

  await ctx.supabase.from('profiles').update(profileUpdate).eq('id', ctx.user.id);

  const merged = {
    ...(ctx.user as any).user_metadata ?? {},
    display_name: displayName, instagram_handle: instagram, language,
  };
  await ctx.supabase.auth.updateUser({ data: merged });

  return ok({ redirect: '/profile/edit?saved=1', language });
}

export async function updateProfile(
  ctx: ServiceContext,
  input: { displayName?: string; instagramHandle?: string; language?: string; next?: string },
): Promise<ServiceResult<{ redirect: string; language: string | null }>> {
  const displayName = input.displayName?.trim().slice(0, 60) || null;
  const instagram = cleanHandle(input.instagramHandle);
  const language = input.language && VALID_LANGS.has(input.language) ? input.language : null;

  const rawNext = input.next ?? '/studio/profile';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/studio/profile';

  const merged = {
    ...(ctx.user as any).user_metadata ?? {},
    display_name: displayName, instagram_handle: instagram, language,
  };
  const { error } = await ctx.supabase.auth.updateUser({ data: merged });
  if (error) {
    console.error('Profile update failed', error);
    return fail('server_error', 'Could not update profile');
  }

  return ok({ redirect: next, language });
}

export async function updateMarketplaceProfile(
  ctx: ServiceContext,
  input: {
    displayName?: string; bio?: string; location?: string;
    instagramHandle?: string; sellerTags: string[];
    profileVisible: boolean; avatar?: File | null;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  const displayName = input.displayName?.trim().slice(0, 60) || null;
  const bio = input.bio?.trim().slice(0, 500) || null;
  const location = input.location?.trim().slice(0, 100) || null;
  const instagram = input.instagramHandle?.trim().replace(/^@+/, '').slice(0, 30) || null;
  const sellerTags = input.sellerTags.filter((t) => VALID_TAGS.has(t));

  let avatarPath: string | undefined;
  if (input.avatar instanceof File && input.avatar.size > 0) {
    if (input.avatar.size > MAX_PHOTO_BYTES) return fail('bad_input', 'Photo too large (max 10 MB)');
    if (!ALLOWED_IMAGE_TYPES.has(input.avatar.type)) return fail('bad_input', 'Unsupported file type');
    const ext = extFromMime(input.avatar.type);
    avatarPath = `${ctx.user.id}/avatar.${ext}`;
    const { error: upErr } = await ctx.supabase.storage
      .from('projects').upload(avatarPath, input.avatar, { contentType: input.avatar.type, upsert: true });
    if (upErr) return fail('server_error', 'Upload failed');
  }

  const update: Record<string, unknown> = {
    display_name: displayName, bio, location,
    instagram_handle: instagram, seller_tags: sellerTags,
    profile_visible: input.profileVisible,
    updated_at: new Date().toISOString(),
  };
  if (avatarPath) update.avatar_path = avatarPath;

  const { error } = await ctx.supabase.from('profiles').update(update).eq('id', ctx.user.id);
  if (error) {
    console.error('Profile update failed', error);
    return fail('server_error', 'Could not update profile');
  }

  return ok({ redirect: '/market/profile?saved=1' });
}

export interface MeData {
  id: string;
  email: string | undefined;
  display_name: string | null;
  avatar_path: string | null;
  unread: number;
  notifications: number;
  inbox_unread: number;
  role: string | null;
  pending_moderation: number;
  has_stores: boolean;
  has_requests: boolean;
}

export async function getMe(ctx: ServiceContext): Promise<ServiceResult<MeData>> {
  const [{ data: profile }, { count: unreadCount }, { count: notifCount }, modUnreadRes] = await Promise.all([
    ctx.supabase.from('profiles').select('display_name, avatar_path, role').eq('id', ctx.user.id).maybeSingle(),
    ctx.supabase.from('marketplace_messages').select('id', { count: 'exact', head: true }).is('read_at', null).neq('sender_id', ctx.user.id),
    ctx.supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    // Unread moderator messages addressed to this user.
    ctx.supabase.from('moderation_messages')
      .select('id, moderation_threads!inner(recipient_id)', { count: 'exact', head: true })
      .is('read_at', null).eq('is_moderator', true)
      .eq('moderation_threads.recipient_id', ctx.user.id),
  ]);
  const modUnread = (modUnreadRes as any)?.count ?? 0;

  const [storesRes, requestsRes] = await Promise.all([
    ctx.supabase.from('store_members').select('store_id', { count: 'exact', head: true }).eq('user_id', ctx.user.id),
    ctx.supabase.from('commission_requests').select('id', { count: 'exact', head: true }).eq('buyer_id', ctx.user.id),
  ]);
  const hasStores = (storesRes.count ?? 0) > 0;
  const hasRequests = (requestsRes.count ?? 0) > 0;

  const isStaff = profile?.role === 'admin' || profile?.role === 'moderator';
  let pendingModeration = 0;
  if (isStaff) {
    // 1. Items waiting for a first moderator decision
    const { count: pending } = await ctx.supabase
      .from('moderation_queue').select('id', { count: 'exact', head: true }).in('status', ['pending', 'escalated']);

    // 2. Shadow reviews waiting for confirmation. Only counted if the
    // current user is eligible (admin OR senior moderator) and NOT the
    // original reviewer.
    let shadowCount = 0;
    const { isShadowEligible } = await import('../admin-auth');
    let eligible = profile?.role === 'admin';
    if (!eligible && profile?.role === 'moderator') {
      const { data: stats } = await ctx.admin
        .from('moderator_stats').select('total_reviews, shadow_overrides')
        .eq('user_id', ctx.user.id).maybeSingle();
      eligible = isShadowEligible('moderator', stats);
    }
    if (eligible) {
      const { count } = await ctx.supabase
        .from('moderation_queue')
        .select('id', { count: 'exact', head: true })
        .eq('shadow_review', true)
        .is('shadow_confirmed_at', null)
        .in('status', ['approved', 'rejected'])
        .neq('decision_by', ctx.user.id);
      shadowCount = count ?? 0;
    }

    // 3. Open reports awaiting moderator action
    const { count: openReports } = await ctx.supabase
      .from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open');

    // 4. Open disputes (admin-only flow)
    let openDisputes = 0;
    if (profile?.role === 'admin') {
      const [{ count: dl }, { count: dc }] = await Promise.all([
        ctx.supabase.from('listings').select('id', { count: 'exact', head: true }).eq('status', 'disputed'),
        ctx.supabase.from('commission_requests').select('id', { count: 'exact', head: true }).eq('status', 'disputed'),
      ]);
      openDisputes = (dl ?? 0) + (dc ?? 0);
    }

    pendingModeration = (pending ?? 0) + shadowCount + (openReports ?? 0) + openDisputes;
  }

  return ok({
    id: ctx.user.id,
    email: ctx.user.email,
    display_name: profile?.display_name ?? null,
    avatar_path: profile?.avatar_path ?? null,
    unread: unreadCount ?? 0,
    notifications: notifCount ?? 0,
    inbox_unread: (unreadCount ?? 0) + (notifCount ?? 0) + modUnread,
    role: isStaff ? profile?.role : null,
    pending_moderation: pendingModeration,
    has_stores: hasStores,
    has_requests: hasRequests,
  });
}
