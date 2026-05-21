import type { SupabaseClient } from '@supabase/supabase-js';

const PRICE_RANGES: Record<string, [number, number]> = {
  genser: [200, 3000],
  cardigan: [200, 3000],
  lue: [50, 800],
  votter: [50, 800],
  sokker: [50, 800],
  teppe: [300, 5000],
  kjole: [200, 3000],
  bukser: [200, 3000],
  annet: [50, 5000],
};

const NORWEGIAN_WORDS = /\b(og|er|det|som|til|for|med|har|jeg|hun|han|vil|kan|den|fra|var|sin|også|eller|ikke|etter|mellom|andre|strikke|garn|ull|merinoull|strikket)\b/i;
const URL_PATTERN = /https?:\/\/[^\s]+/i;

interface ProfileData {
  created_at: string;
  avatar_path: string | null;
  bio: string | null;
  location: string | null;
  instagram_handle: string | null;
  stripe_onboarded: boolean;
  total_completed_transactions: number;
  total_rejections: number;
}

interface ItemData {
  title: string;
  description: string | null;
  price_nok?: number;
  budget_nok_min?: number;
  budget_nok_max?: number;
  category: string;
}

interface ReviewStats {
  avg_rating: number;
  review_count: number;
}

export function computeConfidenceScore(
  profile: ProfileData,
  item: ItemData,
  reviewStats: ReviewStats,
): { total: number; breakdown: { label: string; points: number; max: number }[] } {
  const breakdown: { label: string; points: number; max: number }[] = [];

  // 1. Account age (0-15)
  const days = (Date.now() - new Date(profile.created_at).getTime()) / 86400_000;
  let agePoints = 0;
  if (days >= 365) agePoints = 15;
  else if (days >= 180) agePoints = 12;
  else if (days >= 90) agePoints = 9;
  else if (days >= 30) agePoints = 5;
  else if (days >= 7) agePoints = 2;
  breakdown.push({ label: 'Kontoalder', points: agePoints, max: 15 });

  // 2. Profile completeness (0-20)
  let profilePoints = 0;
  if (profile.avatar_path) profilePoints += 5;
  if (profile.bio && profile.bio.length >= 20) profilePoints += 5;
  if (profile.location) profilePoints += 5;
  if (profile.instagram_handle) profilePoints += 5;
  breakdown.push({ label: 'Profil-utfylling', points: profilePoints, max: 20 });

  // 3. Stripe onboarded (0-10)
  const stripePoints = profile.stripe_onboarded ? 10 : 0;
  breakdown.push({ label: 'Stripe verifisert', points: stripePoints, max: 10 });

  // 4. Completed transactions (0-25)
  const txn = profile.total_completed_transactions;
  let txnPoints = 0;
  if (txn >= 10) txnPoints = 25;
  else if (txn >= 5) txnPoints = 20;
  else if (txn >= 3) txnPoints = 15;
  else if (txn >= 1) txnPoints = 8;
  breakdown.push({ label: 'Fullførte transaksjoner', points: txnPoints, max: 25 });

  // 5. Average review rating (0-15)
  let ratingPoints = 0;
  if (reviewStats.avg_rating >= 4.5 && reviewStats.review_count >= 3) ratingPoints = 15;
  else if (reviewStats.avg_rating >= 4.0 && reviewStats.review_count >= 2) ratingPoints = 10;
  else if (reviewStats.avg_rating >= 3.0 && reviewStats.review_count >= 1) ratingPoints = 5;
  breakdown.push({ label: 'Vurderinger', points: ratingPoints, max: 15 });

  // 6. Past rejections (0 to -20)
  const rejPenalty = Math.min(profile.total_rejections * 5, 20);
  breakdown.push({ label: 'Avvisninger', points: -rejPenalty, max: 0 });

  // 7. Content: price in range (0-5)
  const price = item.price_nok ?? item.budget_nok_max ?? 0;
  const range = PRICE_RANGES[item.category] ?? PRICE_RANGES.annet;
  const priceOk = price >= range[0] && price <= range[1];
  breakdown.push({ label: 'Pris i normalområde', points: priceOk ? 5 : 0, max: 5 });

  // 8. Content: Norwegian text (0-5)
  const text = `${item.title} ${item.description ?? ''}`;
  const norwegianOk = NORWEGIAN_WORDS.test(text);
  breakdown.push({ label: 'Norsk tekst', points: norwegianOk ? 5 : 0, max: 5 });

  // 9. Content: no external URLs (0-5)
  const hasUrls = URL_PATTERN.test(item.description ?? '');
  breakdown.push({ label: 'Ingen eksterne lenker', points: hasUrls ? 0 : 5, max: 5 });

  const total = Math.max(0, Math.min(100, breakdown.reduce((s, b) => s + b.points, 0)));
  return { total, breakdown };
}

/** Confidence score for a store registration. Heavier weighting on whether
 *  the submitter actually appears in Brønnøysund's registered roles for the
 *  organisation — that's the strongest legitimacy signal we have without
 *  full KYC. */
export interface StoreScoreInput {
  profileCreatedAt: string;
  profileTotalRejections: number;
  stripeOnboarded: boolean;
  submitterDisplayName: string | null;
  submitterEmail: string | null;
  storeContactEmail: string | null;
  storeWebsiteUrl: string | null;
  storeDescription: string | null;
  legalFoundedDate: string | null;
  legalBusinessType: string | null;
  /** Names from Brønnøysund's roles endpoint (non-resigned only). */
  registeredRoleNames: string[];
  /** Strong matches (multiple tokens overlap or one name fully contains the other). */
  strongMatchedNames: string[];
  /** Weak matches (single first-name match — common for sole proprietors). */
  weakMatchedNames: string[];
  /** True if the submitter matches any role with signing/CEO/chair-level authority. */
  matchedKeyRole: boolean;
  /** True if a STRONG match was for a key role. */
  strongMatchedKeyRole: boolean;
}

export function computeStoreConfidenceScore(
  input: StoreScoreInput,
): { total: number; breakdown: { label: string; points: number; max: number }[] } {
  const breakdown: { label: string; points: number; max: number }[] = [];

  // 1. Innmelder samsvarer med registrert rolle (0-40)
  let rolePts = 0;
  let roleLabel = 'Innmelder samsvarer med registrert rolle';
  if (input.strongMatchedKeyRole) {
    rolePts = 40;
  } else if (input.strongMatchedNames.length > 0) {
    rolePts = 30;
  } else if (input.weakMatchedNames.length > 0 && input.matchedKeyRole) {
    rolePts = 22;
    roleLabel += ' (delvis navnematch)';
  } else if (input.weakMatchedNames.length > 0) {
    rolePts = 15;
    roleLabel += ' (delvis navnematch)';
  }
  breakdown.push({ label: roleLabel, points: rolePts, max: 40 });

  // 2. Email-domene match (0-10)
  let emailPts = 0;
  if (input.storeWebsiteUrl && input.submitterEmail) {
    try {
      const host = new URL(input.storeWebsiteUrl).hostname.replace(/^www\./, '');
      const emailDomain = input.submitterEmail.split('@')[1];
      if (host && emailDomain && (emailDomain.endsWith(host) || host.endsWith(emailDomain))) {
        emailPts = 10;
      }
    } catch { /* invalid URL */ }
  }
  breakdown.push({ label: 'E-post-domene matcher nettside', points: emailPts, max: 10 });

  // 3. Kontoalder (0-10)
  const days = (Date.now() - new Date(input.profileCreatedAt).getTime()) / 86400_000;
  let agePts = 0;
  if (days >= 365) agePts = 10;
  else if (days >= 90) agePts = 7;
  else if (days >= 30) agePts = 4;
  else if (days >= 7) agePts = 2;
  breakdown.push({ label: 'Kontoalder', points: agePts, max: 10 });

  // 4. Virksomhetens alder (0-10)
  let bizAgePts = 0;
  if (input.legalFoundedDate) {
    const bizDays = (Date.now() - new Date(input.legalFoundedDate).getTime()) / 86400_000;
    if (bizDays >= 365 * 5) bizAgePts = 10;
    else if (bizDays >= 365 * 2) bizAgePts = 7;
    else if (bizDays >= 365) bizAgePts = 4;
    else if (bizDays >= 90) bizAgePts = 2;
  }
  breakdown.push({ label: 'Virksomhetens alder', points: bizAgePts, max: 10 });

  // 5. Beskrivelse + nettside fylt ut (0-10)
  let completenessPts = 0;
  if (input.storeDescription && input.storeDescription.length >= 50) completenessPts += 5;
  if (input.storeWebsiteUrl) completenessPts += 5;
  breakdown.push({ label: 'Butikkprofil fylt ut', points: completenessPts, max: 10 });

  // 6. Stripe Connect verifisert (0-15)
  // For stores this should reflect store.stripe_onboarded, not the user's.
  // We pass it through stripeOnboarded; caller decides what to populate.
  breakdown.push({ label: 'Stripe verifisert', points: input.stripeOnboarded ? 15 : 0, max: 15 });

  // 7. Selskapsform — AS/SA/SAS er mer formelle enn ENK (0-5)
  let bizTypePts = 0;
  if (input.legalBusinessType) {
    const formal = ['AS', 'ASA', 'SA', 'SAMV', 'STAT'];
    if (formal.includes(input.legalBusinessType)) bizTypePts = 5;
    else if (input.legalBusinessType === 'ENK') bizTypePts = 2;
  }
  breakdown.push({ label: 'Selskapsform', points: bizTypePts, max: 5 });

  // 8. Tidligere avvisninger (0 til -20)
  const rejPenalty = Math.min(input.profileTotalRejections * 5, 20);
  breakdown.push({ label: 'Tidligere avvisninger', points: -rejPenalty, max: 0 });

  const total = Math.max(0, Math.min(100, breakdown.reduce((s, b) => s + b.points, 0)));
  return { total, breakdown };
}

/** Maps a store confidence score to a moderator-facing recommendation. */
export interface StoreScoreRecommendation {
  tone: 'green' | 'amber' | 'orange' | 'red';
  label: string;
  detail: string;
}

export function recommendationForStoreScore(total: number): StoreScoreRecommendation {
  if (total >= 75) {
    return {
      tone: 'green',
      label: 'Anbefal godkjenning',
      detail: 'Sterk match mot registrert rolle og gode tillitssignaler. Godkjenn med mindre noe er åpenbart galt.',
    };
  }
  if (total >= 50) {
    return {
      tone: 'amber',
      label: 'Vurder nøye',
      detail: 'Identiteten matcher trolig, men noen signaler mangler. Sjekk rolleliste og kontaktinformasjon før godkjenning.',
    };
  }
  if (total >= 25) {
    return {
      tone: 'orange',
      label: 'Verifiser før godkjenning',
      detail: 'Bare delvis navnematch eller veldig ny virksomhet/konto. Send verifikasjons-e-post før godkjenning.',
    };
  }
  return {
    tone: 'red',
    label: 'Sannsynlig avvisning',
    detail: 'Ingen match mot registrerte representanter. Be om dokumentasjon eller avvis, med mindre du har annen kilde til legitimitet.',
  };
}

export async function getReviewStats(admin: SupabaseClient, userId: string): Promise<ReviewStats> {
  const { data } = await admin
    .from('transaction_reviews')
    .select('rating')
    .eq('reviewee_id', userId)
    .eq('visible', true);

  if (!data?.length) return { avg_rating: 0, review_count: 0 };
  const avg = data.reduce((s, r) => s + r.rating, 0) / data.length;
  return { avg_rating: avg, review_count: data.length };
}

export async function hasConflict(admin: SupabaseClient, moderatorId: string, submitterId: string): Promise<boolean> {
  // Check commission offers
  const { count: offerCount } = await admin
    .from('commission_offers')
    .select('id', { count: 'exact', head: true })
    .eq('knitter_id', moderatorId)
    .in('request_id', admin
      .from('commission_requests')
      .select('id')
      .eq('buyer_id', submitterId)
    );
  if (offerCount && offerCount > 0) return true;

  // Check conversations
  const { count: convCount } = await admin
    .from('marketplace_conversations')
    .select('id', { count: 'exact', head: true })
    .or(`buyer_id.eq.${moderatorId},seller_id.eq.${moderatorId}`)
    .or(`buyer_id.eq.${submitterId},seller_id.eq.${submitterId}`);
  if (convCount && convCount > 0) return true;

  return false;
}

export async function insertQueueItem(
  admin: SupabaseClient,
  itemType: 'listing' | 'commission_request',
  itemId: string,
  submitterId: string,
): Promise<void> {
  await admin.from('moderation_queue').insert({
    item_type: itemType,
    item_id: itemId,
    submitter_id: submitterId,
  });
}

interface QueueItem {
  id: string;
  item_type: string;
  item_id: string;
  submitter_id: string;
  rejection_reason?: string | null;
}

export async function applyApproval(
  admin: SupabaseClient,
  qi: QueueItem,
  actorId: string,
  runtimeEnv: Record<string, any>,
  notify: typeof import('./notify').createNotification,
): Promise<void> {
  const now = new Date().toISOString();
  if (qi.item_type === 'listing') {
    await admin.from('listings').update({
      status: 'active', published_at: now, reviewed_at: now, reviewed_by: actorId,
    }).eq('id', qi.item_id);
  } else if (qi.item_type === 'store') {
    // Approve the store. Tag it as a founding member if among the first 20 approved.
    const { count: approvedSoFar } = await admin
      .from('stores').select('id', { count: 'exact', head: true })
      .not('approved_at', 'is', null);
    const isFoundingMember = (approvedSoFar ?? 0) < 20;
    await admin.from('stores').update({
      status: 'active', approved_at: now, reviewed_at: now, reviewed_by: actorId,
      promo_year_one_free: isFoundingMember,
    }).eq('id', qi.item_id);
  } else {
    await admin.from('commission_requests').update({
      status: 'open', reviewed_at: now, reviewed_by: actorId,
    }).eq('id', qi.item_id);
  }
  let approvedTitle: string, approvedBody: string, approvedUrl: string;
  if (qi.item_type === 'listing') {
    approvedTitle = 'Annonsen din er godkjent!';
    approvedBody = 'Annonsen er nå synlig på Strikketorget.';
    approvedUrl = `/market/listing/${qi.item_id}`;
  } else if (qi.item_type === 'store') {
    approvedTitle = 'Butikken din er godkjent!';
    approvedBody = 'Butikken er nå offentlig på Strikketorget.';
    const { data: s } = await admin.from('stores').select('slug').eq('id', qi.item_id).maybeSingle();
    approvedUrl = s?.slug ? `/market/store/${s.slug}` : `/profile/stores`;
  } else {
    approvedTitle = 'Forespørselen din er godkjent!';
    approvedBody = 'Forespørselen er nå synlig og strikkere kan gi tilbud.';
    approvedUrl = `/market/commissions/${qi.item_id}`;
  }
  await notify(admin, {
    userId: qi.submitter_id,
    type: 'item_approved',
    title: approvedTitle,
    body: approvedBody,
    url: approvedUrl,
    actorId,
    referenceId: qi.item_id,
  }, runtimeEnv);
}

export async function applyRejection(
  admin: SupabaseClient,
  qi: QueueItem,
  actorId: string,
  runtimeEnv: Record<string, any>,
  notify: typeof import('./notify').createNotification,
  opts: { stripeSecretKey?: string; createStripe?: (key: string) => any },
): Promise<void> {
  const now = new Date().toISOString();
  const reason = qi.rejection_reason ?? null;

  await admin.rpc('increment_profile_rejections', { p_user_id: qi.submitter_id });

  if (qi.item_type === 'listing') {
    await admin.from('listings').update({
      status: 'rejected', moderation_notes: reason, reviewed_at: now, reviewed_by: actorId,
    }).eq('id', qi.item_id);

    if (opts.stripeSecretKey && opts.createStripe) {
      const { data: listing } = await admin.from('listings')
        .select('listing_fee_session_id').eq('id', qi.item_id).maybeSingle();
      if (listing?.listing_fee_session_id) {
        try {
          const stripe = opts.createStripe(opts.stripeSecretKey);
          const session = await stripe.checkout.sessions.retrieve(listing.listing_fee_session_id);
          if (session.payment_intent) {
            await stripe.refunds.create({
              payment_intent: typeof session.payment_intent === 'string'
                ? session.payment_intent : session.payment_intent.id,
            });
          }
        } catch (e) {
          console.error('Refund failed', e);
        }
      }
    }
  } else if (qi.item_type === 'store') {
    await admin.from('stores').update({
      status: 'suspended', reviewed_at: now, reviewed_by: actorId,
    }).eq('id', qi.item_id);
    // Hide store listings while suspended. In-flight sales are left alone
    // so buyer flow keeps working.
    await admin.from('listings')
      .update({ status: 'archived' })
      .eq('store_id', qi.item_id)
      .in('status', ['active', 'draft', 'pending_review']);
  } else {
    await admin.from('commission_requests').update({
      status: 'rejected', moderation_notes: reason, reviewed_at: now, reviewed_by: actorId,
    }).eq('id', qi.item_id);
  }

  let rejTitle: string, rejUrl: string;
  if (qi.item_type === 'listing') {
    rejTitle = 'Annonsen din ble avvist';
    rejUrl = `/market/listing/${qi.item_id}`;
  } else if (qi.item_type === 'store') {
    rejTitle = 'Butikken din ble avvist';
    const { data: s } = await admin.from('stores').select('slug').eq('id', qi.item_id).maybeSingle();
    rejUrl = s?.slug ? `/market/store/${s.slug}/admin` : '/profile/stores';
  } else {
    rejTitle = 'Forespørselen din ble avvist';
    rejUrl = `/market/commissions/${qi.item_id}`;
  }
  await notify(admin, {
    userId: qi.submitter_id,
    type: 'item_rejected',
    title: rejTitle,
    body: reason ?? 'Innholdet oppfyller ikke retningslinjene våre.',
    url: rejUrl,
    actorId,
    referenceId: qi.item_id,
  }, runtimeEnv);

  const { recalculateTrust } = await import('./trust');
  await recalculateTrust(admin, qi.submitter_id);
}
