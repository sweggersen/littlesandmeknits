import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime, projectPhotoUrl } from '../storage';
import { isValidKontonummer, normalizeKontonummer } from '../kontonummer';
import { createSellerConnectAccount } from './stripe-connect';

const VALID_LANGS = new Set(['nb', 'en']);
const VALID_TAGS = new Set(['knitter', 'sells_pre_loved', 'sells_ready_made', 'open_for_requests', 'dyer']);

function cleanHandle(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@+/, '');
  if (!trimmed || !/^[A-Za-z0-9._]{1,30}$/.test(trimmed)) return null;
  return trimmed;
}

const STRIKKETORGET_VALID_INTERESTS = new Set([
  'children', 'adult', 'genser', 'cardigan', 'lue', 'votter',
  'sokker', 'teppe', 'kjole', 'bukser',
]);

/** Mark the user as Strikketorget-welcomed and persist their interest
 *  selection. `action: 'skip'` records a welcome with no preferences. */
export async function completeStrikketorgetWelcome(
  ctx: ServiceContext,
  input: { action: 'save' | 'skip'; interests: string[] },
): Promise<ServiceResult<{ redirect: string }>> {
  const filtered = input.interests.filter((v) => STRIKKETORGET_VALID_INTERESTS.has(v));
  await ctx.supabase
    .from('profiles')
    .update({
      strikketorget_welcomed_at: new Date().toISOString(),
      marketplace_interests: input.action === 'skip' ? null : filtered,
    })
    .eq('id', ctx.user.id);
  return ok({ redirect: '/market' });
}

/** GDPR Art. 15 (right of access) + Art. 20 (data portability).
 *  Collect every personal datum we hold about ctx.user into a single
 *  JSON-serialisable object. The route streams it as a download. */
export async function exportPersonalData(
  ctx: ServiceContext,
): Promise<ServiceResult<Record<string, unknown>>> {
  const [
    profileRes, listingsRes, purchasesRes, favoritesRes, conversationsRes,
    messagesRes, notificationsRes, reviewsGivenRes, reviewsReceivedRes,
    storeMembersRes, commissionsRes, offersRes, reportsFiledRes, modThreadsRes,
    authUserRes,
  ] = await Promise.all([
    ctx.supabase.from('profiles').select('*').eq('id', ctx.user.id).maybeSingle(),
    ctx.supabase.from('listings').select('*').eq('seller_id', ctx.user.id),
    ctx.supabase.from('listings').select('*').eq('buyer_id', ctx.user.id),
    ctx.supabase.from('favorites').select('*').eq('user_id', ctx.user.id),
    ctx.supabase.from('marketplace_conversations').select('*').or(`buyer_id.eq.${ctx.user.id},seller_id.eq.${ctx.user.id}`),
    ctx.supabase.from('marketplace_messages').select('*').eq('sender_id', ctx.user.id),
    ctx.supabase.from('notifications').select('*').eq('user_id', ctx.user.id),
    ctx.supabase.from('seller_reviews').select('*').eq('reviewer_id', ctx.user.id),
    ctx.supabase.from('seller_reviews').select('*').eq('seller_id', ctx.user.id),
    ctx.supabase.from('store_members').select('*').eq('user_id', ctx.user.id),
    ctx.supabase.from('commission_requests').select('*').eq('buyer_id', ctx.user.id),
    ctx.supabase.from('commission_offers').select('*').eq('knitter_id', ctx.user.id),
    ctx.supabase.from('reports').select('*').eq('reporter_id', ctx.user.id),
    ctx.supabase.from('moderation_threads').select('*').eq('recipient_id', ctx.user.id),
    // auth.users isn't RLS-readable by end users; admin client is the right tool.
    ctx.admin.auth.admin.getUserById(ctx.user.id),
  ]);

  return ok({
    exportedAt: new Date().toISOString(),
    note: 'GDPR data export. Includes everything we hold about you across Littles and Me Knits, Strikketorget and Strikkestua.',
    auth: {
      id: ctx.user.id,
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
  });
}

export interface BookkeepingRow {
  date: string;
  type: string;
  item_id: string;
  title: string;
  gross_nok: number;
  fee_nok: number;
  net_nok: number;
  channel: string;
  status: string;
}

/** Seller bookkeeping rows for a given date window. Returns sold listings
 *  + completed commissions, oldest-first, with a totals object the route
 *  can format into CSV / JSON / dashboard. */
export async function getBookkeeping(
  ctx: ServiceContext,
  input: { fromIso: string; toIso: string },
): Promise<ServiceResult<{ rows: BookkeepingRow[]; totals: { gross: number; fee: number; net: number } }>> {
  const { data: soldListings } = await ctx.admin
    .from('listings')
    .select('id, title, price_nok, platform_fee_nok, sold_at, status, kind, store_id')
    .eq('seller_id', ctx.user.id)
    .in('status', ['sold', 'delivered'])
    .gte('sold_at', input.fromIso)
    .lte('sold_at', input.toIso + 'T23:59:59.999Z')
    .order('sold_at', { ascending: true });

  const { data: knitterOffers } = await ctx.admin
    .from('commission_offers')
    .select('id, price_nok, request_id, status, accepted_at, knitter_id, commission_requests!commission_offers_request_id_fkey(id, title, delivered_at, status, platform_fee_nok)')
    .eq('knitter_id', ctx.user.id)
    .eq('status', 'accepted');

  const rows: BookkeepingRow[] = [];

  for (const l of soldListings ?? []) {
    const fee = (l as any).platform_fee_nok ?? 0;
    rows.push({
      date: ((l as any).sold_at ?? '').slice(0, 10),
      type: (l as any).kind === 'pre_loved' ? 'brukt' : 'nytt',
      item_id: (l as any).id,
      title: (l as any).title,
      gross_nok: (l as any).price_nok,
      fee_nok: fee,
      net_nok: (l as any).price_nok - fee,
      channel: (l as any).store_id ? 'butikk' : 'privatsalg',
      status: (l as any).status,
    });
  }

  for (const o of (knitterOffers ?? []) as any[]) {
    const req = o.commission_requests;
    if (!req || !req.delivered_at) continue;
    const d = req.delivered_at as string;
    if (d.slice(0, 10) < input.fromIso || d.slice(0, 10) > input.toIso) continue;
    const fee = req.platform_fee_nok ?? 0;
    rows.push({
      date: d.slice(0, 10),
      type: 'oppdrag',
      item_id: req.id,
      title: req.title,
      gross_nok: o.price_nok,
      fee_nok: fee,
      net_nok: o.price_nok - fee,
      channel: 'oppdrag',
      status: req.status,
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));

  const totals = rows.reduce(
    (acc, r) => ({ gross: acc.gross + r.gross_nok, fee: acc.fee + r.fee_nok, net: acc.net + r.net_nok }),
    { gross: 0, fee: 0, net: 0 },
  );

  return ok({ rows, totals });
}

/** Delete the user's account per GDPR Art. 17 ("right to be forgotten").
 *  Refuses if there are pending obligations (open trades, open moderator
 *  threads). On success: anonymises the profile, wipes personal artifacts,
 *  archives draft listings, and removes the auth user. Transaction
 *  history is retained 5 years per Norwegian bokføringsloven.
 *  Returns the redirect target; the route clears the session cookies. */
export async function deleteAccount(
  ctx: ServiceContext,
  input: { confirm: string },
): Promise<ServiceResult<{ redirect: string }>> {
  if (input.confirm !== 'SLETT') {
    return fail('bad_input', 'Skriv SLETT for å bekrefte');
  }

  // 1. Refuse if there are pending obligations.
  const blockers: string[] = [];
  const { count: openListings } = await ctx.admin
    .from('listings').select('id', { count: 'exact', head: true })
    .eq('seller_id', ctx.user.id).in('status', ['reserved', 'shipped', 'disputed', 'frozen']);
  if ((openListings ?? 0) > 0) blockers.push(`${openListings} aktive salg`);

  const { count: pendingPurchases } = await ctx.admin
    .from('listings').select('id', { count: 'exact', head: true })
    .eq('buyer_id', ctx.user.id).in('status', ['reserved', 'shipped', 'disputed']);
  if ((pendingPurchases ?? 0) > 0) blockers.push(`${pendingPurchases} aktive kjøp`);

  const { count: openThreads } = await ctx.admin
    .from('moderation_threads').select('id', { count: 'exact', head: true })
    .eq('recipient_id', ctx.user.id).eq('status', 'open');
  if ((openThreads ?? 0) > 0) blockers.push(`${openThreads} aktive moderasjonssaker`);

  if (blockers.length) {
    return fail(
      'conflict',
      `Kontoen kan ikke slettes med pågående saker: ${blockers.join(', ')}. `
        + `Fullfør disse først, eller kontakt oss på hei@littlesandmeknits.com.`,
    );
  }

  // 2. Anonymise the profile + clear personal content.
  const anonName = `slettet-${ctx.user.id.slice(0, 8)}`;
  await ctx.admin.from('profiles').update({
    display_name: anonName,
    avatar_path: null,
    bio: null,
    instagram_handle: null,
    location: null,
    seller_tags: null,
    deleted_at: new Date().toISOString(),
  }).eq('id', ctx.user.id);

  await ctx.admin.from('favorites').delete().eq('user_id', ctx.user.id);
  await ctx.admin.from('notifications').delete().eq('user_id', ctx.user.id);
  await ctx.admin.from('notification_preferences').delete().eq('user_id', ctx.user.id);

  await ctx.admin.from('listings').update({ status: 'removed' })
    .eq('seller_id', ctx.user.id).in('status', ['draft', 'pending_review', 'active']);

  // 3. Delete the auth user (revokes all sessions, removes login).
  await ctx.admin.auth.admin.deleteUser(ctx.user.id);

  return ok({ redirect: '/?deleted=1' });
}

/** Onboard a seller — collect payout details, create the Stripe Connect
 *  Custom account, save the profile fields. Returns a redirect target.
 *  Fine-grained validation errors use bad_input with a specific message
 *  ('bad_kontonummer' / 'bad_name' / 'bad_birthdate' / 'stripe_error')
 *  the route maps back to the ?error= query the form expects. */
export async function becomeSeller(
  ctx: ServiceContext,
  input: {
    legalName: string;
    birthdate: string;
    kontonummer: string;
    address: string;
    postalCode: string;
    city: string;
  },
): Promise<ServiceResult<{ redirect: string }>> {
  const legalName = input.legalName.trim();
  if (!legalName || legalName.split(/\s+/).length < 2) {
    return fail('bad_input', 'bad_name');
  }
  if (!input.birthdate) return fail('bad_input', 'bad_birthdate');
  if (!isValidKontonummer(input.kontonummer)) return fail('bad_input', 'bad_kontonummer');

  // RLS-safe read: profile owner reads their own row.
  const { data: existing } = await ctx.supabase
    .from('profiles')
    .select('stripe_account_id, stripe_connect_status')
    .eq('id', ctx.user.id)
    .maybeSingle();

  let accountId = (existing as any)?.stripe_account_id as string | null ?? null;

  if (!accountId) {
    const result = await createSellerConnectAccount(ctx.env.STRIPE_SECRET_KEY, {
      legalName,
      birthdate: input.birthdate,
      kontonummer: input.kontonummer,
      address: input.address,
      postalCode: input.postalCode,
      city: input.city,
      email: ctx.user.email ?? '',
    });
    if (!result.ok) {
      console.error('Become-seller create failed', result);
      return fail('bad_input', result.reason ?? 'stripe_error');
    }
    accountId = result.accountId ?? null;
  }

  // Service-role write because the profile row's RLS policy is
  // limited to read-own; this updates fields the user actually
  // entered, scoped to their own row.
  const { error: updateError } = await ctx.admin
    .from('profiles')
    .update({
      seller_legal_name: legalName,
      seller_birthdate: input.birthdate,
      seller_kontonummer: normalizeKontonummer(input.kontonummer),
      seller_address: input.address,
      seller_postal_code: input.postalCode,
      seller_city: input.city,
      seller_terms_accepted_at: new Date().toISOString(),
      stripe_account_id: accountId,
      stripe_connect_status: (existing as any)?.stripe_connect_status === 'verified'
        ? 'verified'
        : 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', ctx.user.id);
  if (updateError) {
    console.error('Become-seller profile update failed', updateError);
    return fail('server_error', 'Could not save seller profile');
  }

  return ok({ redirect: '/profile/become-seller?submitted=1' });
}

/** Persist a self-reported birthday on the profile. Validates the parts
 *  and caps the year so we don't accept impossible dates. */
export async function setBirthday(
  ctx: ServiceContext,
  input: { day?: string | number; month?: string | number; year?: string | number },
): Promise<ServiceResult<{ birthday: string | null }>> {
  const day = Number(input.day);
  const month = Number(input.month);
  const year = Number(input.year);
  const thisYear = new Date().getFullYear();
  if (!Number.isInteger(day) || day < 1 || day > 31) return fail('bad_input', 'Ugyldig dag');
  if (!Number.isInteger(month) || month < 1 || month > 12) return fail('bad_input', 'Ugyldig måned');
  if (!Number.isInteger(year) || year < 1900 || year > thisYear) return fail('bad_input', 'Ugyldig år');

  // Double-check the day fits the month/year (handles Feb 30 etc.).
  const composed = new Date(Date.UTC(year, month - 1, day));
  if (
    composed.getUTCFullYear() !== year
    || composed.getUTCMonth() !== month - 1
    || composed.getUTCDate() !== day
  ) {
    return fail('bad_input', 'Ugyldig dato');
  }

  const birthday = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  const { error } = await ctx.supabase
    .from('profiles')
    .update({ birthday })
    .eq('id', ctx.user.id);
  if (error) return fail('server_error', 'Kunne ikke lagre bursdag');
  return ok({ birthday });
}

export async function editProfile(
  ctx: ServiceContext,
  input: {
    displayName?: string;
    firstName?: string; lastName?: string;
    bio?: string; location?: string;
    instagramHandle?: string; language?: string;
    sellerTags: string[]; profileVisible: boolean;
    avatar?: File | null;
  },
): Promise<ServiceResult<{ redirect: string; language: string | null }>> {
  const firstName = input.firstName?.trim().slice(0, 40) || null;
  const lastName = input.lastName?.trim().slice(0, 40) || null;
  // displayName left empty → auto-compose from first+last so the public
  // name doesn't accidentally disappear when a user clears it.
  let displayName = input.displayName?.trim().slice(0, 60) || null;
  if (!displayName) {
    const composed = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (composed) displayName = composed;
  }
  const bio = input.bio?.trim().slice(0, 500) || null;
  const location = input.location?.trim().slice(0, 100) || null;
  const instagram = cleanHandle(input.instagramHandle);
  const language = input.language && VALID_LANGS.has(input.language) ? input.language : null;
  const sellerTags = input.sellerTags.filter((t) => VALID_TAGS.has(t));

  let avatarPath: string | undefined;
  if (input.avatar instanceof File && input.avatar.size > 0) {
    if (input.avatar.size > MAX_PHOTO_BYTES) {
      return fail('bad_input', 'Profilbildet er for stort (maks 10 MB)');
    }
    if (!ALLOWED_IMAGE_TYPES.has(input.avatar.type)) {
      return fail('bad_input', 'Filtypen støttes ikke. Bruk JPG, PNG eller WebP.');
    }
    // Use the admin client so storage RLS can't silently drop the upload.
    // Path is namespaced by user id, so cross-user writes aren't possible
    // even with the bypass.
    const ext = extFromMime(input.avatar.type);
    const path = `avatars/${ctx.user.id}.${ext}`;
    const { error: uploadError } = await ctx.admin.storage
      .from('projects')
      .upload(path, input.avatar, { upsert: true, contentType: input.avatar.type });
    if (uploadError) {
      console.error('Avatar upload failed', uploadError);
      return fail('server_error', `Kunne ikke laste opp profilbildet: ${uploadError.message}`);
    }
    avatarPath = path;
  }

  const profileUpdate: Record<string, any> = {
    display_name: displayName, first_name: firstName, last_name: lastName,
    bio, location,
    instagram_handle: instagram, seller_tags: sellerTags,
    profile_visible: input.profileVisible,
    // profiles has no updated_at trigger, so set it explicitly. The
    // cache-buster on the avatar URL keys off this — without bumping it
    // here, re-uploads to the same storage path don't bust the cache.
    updated_at: new Date().toISOString(),
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
  avatar_url: string | null;
  member_since: string | null;
  unread: number;
  notifications: number;
  inbox_unread: number;
  role: string | null;
  pending_moderation: number;
  has_stores: boolean;
  has_requests: boolean;
}

// Formats a profile creation date as "Medlem siden <måned> <år>" in
// Norwegian, e.g. "Medlem siden mai 2026". Returns null if no date.
function formatMemberSince(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const months = [
    'januar', 'februar', 'mars', 'april', 'mai', 'juni',
    'juli', 'august', 'september', 'oktober', 'november', 'desember',
  ];
  return `Medlem siden ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export async function getMe(ctx: ServiceContext): Promise<ServiceResult<MeData>> {
  const [{ data: profile }, { count: unreadCount }, { count: notifCount }, modUnreadRes] = await Promise.all([
    ctx.supabase.from('profiles').select('display_name, avatar_path, role, created_at, updated_at').eq('id', ctx.user.id).maybeSingle(),
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
    avatar_url: (() => {
      const path = profile?.avatar_path;
      if (!path) return null;
      const base = projectPhotoUrl(path);
      if (!base) return null;
      // Cache-buster derived from profiles.updated_at so re-uploads to
      // the same path (avatars/<uid>.jpg) bypass the browser cache.
      const v = (profile as any)?.updated_at
        ? new Date((profile as any).updated_at).getTime()
        : '';
      return `${base}?v=${v}`;
    })(),
    member_since: formatMemberSince((profile as any)?.created_at),
    unread: unreadCount ?? 0,
    notifications: notifCount ?? 0,
    inbox_unread: (unreadCount ?? 0) + (notifCount ?? 0) + modUnread,
    role: isStaff ? profile?.role : null,
    pending_moderation: pendingModeration,
    has_stores: hasStores,
    has_requests: hasRequests,
  });
}
