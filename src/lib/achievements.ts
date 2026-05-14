import type { SupabaseClient } from '@supabase/supabase-js';
import { createNotification } from './notify';

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

export interface AchievementDef {
  key: string;
  emoji: string;
  label: string;
  description: string;
  category: 'profil' | 'strikking' | 'marked' | 'fellesskap' | 'moderering';
  tier?: AchievementTier;
}

export const TIER_LABEL: Record<AchievementTier, string> = {
  bronze: 'Bronse',
  silver: 'Sølv',
  gold: 'Gull',
  platinum: 'Platina',
  diamond: 'Diamant',
};

export const TIER_COLOR: Record<AchievementTier, string> = {
  bronze: 'text-amber-700',
  silver: 'text-gray-400',
  gold: 'text-yellow-500',
  platinum: 'text-cyan-400',
  diamond: 'text-violet-400',
};

export const ACHIEVEMENTS: AchievementDef[] = [
  // ═══════════════════════════════════════════
  // ── Profil ──
  // ═══════════════════════════════════════════
  { key: 'first_avatar', emoji: '📸', label: 'Profilbilde', description: 'Lastet opp et profilbilde', category: 'profil' },
  { key: 'bio_written', emoji: '✏️', label: 'Forteller', description: 'Skrev en bio', category: 'profil' },
  { key: 'full_profile', emoji: '🌟', label: 'Komplett profil', description: 'Fylte ut alle profilfelt', category: 'profil' },
  { key: 'instagram_linked', emoji: '📱', label: 'Instagrammer', description: 'Koblet til Instagram', category: 'profil' },
  { key: 'stripe_onboarded', emoji: '💳', label: 'Klar for salg', description: 'Koblet til Stripe for utbetalinger', category: 'profil' },

  // Membership tiers
  { key: 'member_30d', emoji: '🌱', label: 'Ny spire', description: 'Vært medlem i 30 dager', category: 'profil', tier: 'bronze' },
  { key: 'member_90d', emoji: '🌿', label: 'Rotfestet', description: 'Vært medlem i 90 dager', category: 'profil', tier: 'silver' },
  { key: 'member_180d', emoji: '🌳', label: 'Trofast', description: 'Vært medlem i et halvt år', category: 'profil', tier: 'gold' },
  { key: 'member_365d', emoji: '🎂', label: 'Ettåring', description: 'Feiret ett år som medlem', category: 'profil', tier: 'platinum' },
  { key: 'member_730d', emoji: '🎊', label: 'Toåring', description: 'Feiret to år som medlem', category: 'profil', tier: 'diamond' },
  { key: 'member_1095d', emoji: '👑', label: 'Veteran', description: 'Tre år som tro medlem', category: 'profil', tier: 'diamond' },

  // ═══════════════════════════════════════════
  // ── Strikking ──
  // ═══════════════════════════════════════════

  // Projects
  { key: 'first_project', emoji: '🧶', label: 'Første prosjekt', description: 'Opprettet et strikkeprosjekt', category: 'strikking' },
  { key: 'project_finished', emoji: '🏁', label: 'Første plagg', description: 'Fullførte et strikkeprosjekt', category: 'strikking' },
  { key: 'projects_3', emoji: '🧵', label: 'Plagg — Bronse', description: 'Fullført 3 prosjekter', category: 'strikking', tier: 'bronze' },
  { key: 'projects_5', emoji: '🎯', label: 'Plagg — Sølv', description: 'Fullført 5 prosjekter', category: 'strikking', tier: 'silver' },
  { key: 'projects_10', emoji: '🏆', label: 'Plagg — Gull', description: 'Fullført 10 prosjekter', category: 'strikking', tier: 'gold' },
  { key: 'projects_25', emoji: '💎', label: 'Plagg — Platina', description: 'Fullført 25 prosjekter', category: 'strikking', tier: 'platinum' },
  { key: 'projects_50', emoji: '👑', label: 'Plagg — Diamant', description: 'Fullført 50 prosjekter', category: 'strikking', tier: 'diamond' },
  { key: 'projects_100', emoji: '🌟', label: 'Plagg — Legendar', description: 'Fullført 100 prosjekter — du er legendarisk!', category: 'strikking', tier: 'diamond' },
  { key: 'projects_250', emoji: '✨', label: 'Plagg — Mester', description: 'Fullført 250 prosjekter — uslåelig', category: 'strikking', tier: 'diamond' },

  // Logs
  { key: 'first_log', emoji: '📝', label: 'Dagbokfører', description: 'Skrev første prosjektlogg', category: 'strikking' },
  { key: 'logs_10', emoji: '📝', label: 'Logger — Bronse', description: 'Skrevet 10 prosjektlogger', category: 'strikking', tier: 'bronze' },
  { key: 'logs_25', emoji: '📝', label: 'Logger — Sølv', description: 'Skrevet 25 prosjektlogger', category: 'strikking', tier: 'silver' },
  { key: 'logs_50', emoji: '📝', label: 'Logger — Gull', description: 'Skrevet 50 prosjektlogger', category: 'strikking', tier: 'gold' },
  { key: 'logs_100', emoji: '📝', label: 'Logger — Platina', description: 'Skrevet 100 prosjektlogger', category: 'strikking', tier: 'platinum' },
  { key: 'logs_250', emoji: '📝', label: 'Logger — Diamant', description: 'Skrevet 250 prosjektlogger', category: 'strikking', tier: 'diamond' },

  // Photos
  { key: 'photo_uploaded', emoji: '📷', label: 'Fotograf', description: 'La til et bilde i en prosjektlogg', category: 'strikking' },
  { key: 'photos_10', emoji: '🖼️', label: 'Bilder — Bronse', description: 'Delt 10 prosjektbilder', category: 'strikking', tier: 'bronze' },
  { key: 'photos_25', emoji: '🖼️', label: 'Bilder — Sølv', description: 'Delt 25 prosjektbilder', category: 'strikking', tier: 'silver' },
  { key: 'photos_50', emoji: '🖼️', label: 'Bilder — Gull', description: 'Delt 50 prosjektbilder', category: 'strikking', tier: 'gold' },
  { key: 'photos_100', emoji: '🖼️', label: 'Bilder — Platina', description: 'Delt 100 prosjektbilder', category: 'strikking', tier: 'platinum' },
  { key: 'photos_250', emoji: '🖼️', label: 'Bilder — Diamant', description: 'Delt 250 prosjektbilder — fotoarkiv!', category: 'strikking', tier: 'diamond' },

  // Row counter
  { key: 'row_counter', emoji: '🔢', label: 'Pinneteller', description: 'Brukte radtelleren for første gang', category: 'strikking' },
  { key: 'rows_1000', emoji: '🔢', label: 'Rader — Bronse', description: '1 000 rader strikket', category: 'strikking', tier: 'bronze' },
  { key: 'rows_5000', emoji: '🔢', label: 'Rader — Sølv', description: '5 000 rader strikket', category: 'strikking', tier: 'silver' },
  { key: 'rows_10000', emoji: '🔢', label: 'Rader — Gull', description: '10 000 rader strikket', category: 'strikking', tier: 'gold' },
  { key: 'rows_50000', emoji: '🔢', label: 'Rader — Platina', description: '50 000 rader strikket', category: 'strikking', tier: 'platinum' },
  { key: 'rows_100000', emoji: '🔢', label: 'Rader — Diamant', description: '100 000 rader strikket — uendelig!', category: 'strikking', tier: 'diamond' },

  // Frogged
  { key: 'frogged', emoji: '🐸', label: 'Frosk!', description: 'Røkte opp et prosjekt — modig!', category: 'strikking' },
  { key: 'frogged_5', emoji: '🐸', label: 'Frosk — Bronse', description: 'Røkte opp 5 prosjekter', category: 'strikking', tier: 'bronze' },
  { key: 'frogged_10', emoji: '🐸', label: 'Frosk — Sølv', description: 'Røkte opp 10 prosjekter — ingen skam!', category: 'strikking', tier: 'silver' },

  // Categories
  { key: 'all_categories', emoji: '🌈', label: 'Allrounder', description: 'Strikket i alle kategorier', category: 'strikking' },

  // ═══════════════════════════════════════════
  // ── Strikketorget ──
  // ═══════════════════════════════════════════

  // Listings
  { key: 'first_listing', emoji: '🏷️', label: 'Første annonse', description: 'Publiserte en annonse på torget', category: 'marked' },
  { key: 'listings_5', emoji: '🏷️', label: 'Annonser — Bronse', description: 'Publisert 5 annonser', category: 'marked', tier: 'bronze' },
  { key: 'listings_10', emoji: '🏷️', label: 'Annonser — Sølv', description: 'Publisert 10 annonser', category: 'marked', tier: 'silver' },
  { key: 'listings_25', emoji: '🏷️', label: 'Annonser — Gull', description: 'Publisert 25 annonser', category: 'marked', tier: 'gold' },
  { key: 'listings_50', emoji: '🏷️', label: 'Annonser — Platina', description: 'Publisert 50 annonser', category: 'marked', tier: 'platinum' },

  // Sales
  { key: 'first_sale', emoji: '🤝', label: 'Første salg', description: 'Solgte noe på strikketorget', category: 'marked' },
  { key: 'sales_5', emoji: '📦', label: 'Salg — Bronse', description: 'Solgt 5 ting på torget', category: 'marked', tier: 'bronze' },
  { key: 'sales_10', emoji: '🏪', label: 'Salg — Sølv', description: 'Solgt 10 ting på torget', category: 'marked', tier: 'silver' },
  { key: 'sales_25', emoji: '💎', label: 'Salg — Gull', description: 'Solgt 25 ting på torget', category: 'marked', tier: 'gold' },
  { key: 'sales_50', emoji: '🏅', label: 'Salg — Platina', description: 'Solgt 50 ting på torget', category: 'marked', tier: 'platinum' },
  { key: 'sales_100', emoji: '👑', label: 'Salg — Diamant', description: 'Solgt 100 ting — strikketorgets dronning!', category: 'marked', tier: 'diamond' },

  // Purchases
  { key: 'first_purchase', emoji: '🛍️', label: 'Første kjøp', description: 'Kjøpte noe på strikketorget', category: 'marked' },
  { key: 'purchases_5', emoji: '🛍️', label: 'Kjøp — Bronse', description: 'Kjøpt 5 ting på torget', category: 'marked', tier: 'bronze' },
  { key: 'purchases_10', emoji: '🛍️', label: 'Kjøp — Sølv', description: 'Kjøpt 10 ting på torget', category: 'marked', tier: 'silver' },
  { key: 'purchases_25', emoji: '🛍️', label: 'Kjøp — Gull', description: 'Kjøpt 25 ting på torget', category: 'marked', tier: 'gold' },

  // Commissions (requesting)
  { key: 'first_commission', emoji: '📋', label: 'Bestiller', description: 'Opprettet en strikkeforespørsel', category: 'marked' },
  { key: 'commissions_requested_5', emoji: '📋', label: 'Forespørsler — Bronse', description: '5 strikkeforespørsler opprettet', category: 'marked', tier: 'bronze' },
  { key: 'commissions_requested_10', emoji: '📋', label: 'Forespørsler — Sølv', description: '10 strikkeforespørsler opprettet', category: 'marked', tier: 'silver' },

  // Offers
  { key: 'first_offer', emoji: '✋', label: 'Tilbyder', description: 'Ga et tilbud på et oppdrag', category: 'marked' },
  { key: 'offers_5', emoji: '✋', label: 'Tilbud — Bronse', description: 'Gitt 5 tilbud', category: 'marked', tier: 'bronze' },
  { key: 'offers_10', emoji: '✋', label: 'Tilbud — Sølv', description: 'Gitt 10 tilbud', category: 'marked', tier: 'silver' },
  { key: 'offers_25', emoji: '✋', label: 'Tilbud — Gull', description: 'Gitt 25 tilbud', category: 'marked', tier: 'gold' },

  // Commissions completed (as knitter)
  { key: 'commission_completed', emoji: '🎁', label: 'Oppdraget levert', description: 'Fullførte et strikke-oppdrag', category: 'marked' },
  { key: 'commissions_5', emoji: '⭐', label: 'Oppdrag — Bronse', description: 'Fullført 5 oppdrag', category: 'marked', tier: 'bronze' },
  { key: 'commissions_10', emoji: '🌟', label: 'Oppdrag — Sølv', description: 'Fullført 10 oppdrag', category: 'marked', tier: 'silver' },
  { key: 'commissions_25', emoji: '💫', label: 'Oppdrag — Gull', description: 'Fullført 25 oppdrag', category: 'marked', tier: 'gold' },
  { key: 'commissions_50', emoji: '👑', label: 'Oppdrag — Platina', description: 'Fullført 50 oppdrag — superknytter!', category: 'marked', tier: 'platinum' },

  // Favorites given
  { key: 'first_favorite', emoji: '❤️', label: 'Hjerteklikk', description: 'Lagret en favoritt', category: 'marked' },
  { key: 'favorites_10', emoji: '💕', label: 'Favoritter — Bronse', description: 'Samlet 10 favoritter', category: 'marked', tier: 'bronze' },
  { key: 'favorites_25', emoji: '💕', label: 'Favoritter — Sølv', description: 'Samlet 25 favoritter', category: 'marked', tier: 'silver' },
  { key: 'favorites_50', emoji: '💕', label: 'Favoritter — Gull', description: 'Samlet 50 favoritter', category: 'marked', tier: 'gold' },
  { key: 'favorites_100', emoji: '💕', label: 'Favoritter — Platina', description: 'Samlet 100 favoritter', category: 'marked', tier: 'platinum' },

  // Favorites received
  { key: 'got_favorited', emoji: '🔥', label: 'Populær', description: 'Noen favorittmerket annonsen din', category: 'marked' },
  { key: 'got_favorited_10', emoji: '💖', label: 'Ettertraktet — Bronse', description: 'Fått 10 favoritter totalt', category: 'marked', tier: 'bronze' },
  { key: 'got_favorited_25', emoji: '💖', label: 'Ettertraktet — Sølv', description: 'Fått 25 favoritter totalt', category: 'marked', tier: 'silver' },
  { key: 'got_favorited_50', emoji: '💖', label: 'Ettertraktet — Gull', description: 'Fått 50 favoritter totalt', category: 'marked', tier: 'gold' },
  { key: 'got_favorited_100', emoji: '💖', label: 'Ettertraktet — Platina', description: 'Fått 100 favoritter — ikonisk!', category: 'marked', tier: 'platinum' },

  // Revenue milestones
  { key: 'revenue_1000', emoji: '💰', label: 'Første tusenlapp', description: 'Tjent 1 000 kr på strikketorget', category: 'marked', tier: 'bronze' },
  { key: 'revenue_5000', emoji: '💰', label: 'Fem tusen', description: 'Tjent 5 000 kr på strikketorget', category: 'marked', tier: 'silver' },
  { key: 'revenue_10000', emoji: '💰', label: 'Ti tusen', description: 'Tjent 10 000 kr på strikketorget', category: 'marked', tier: 'gold' },
  { key: 'revenue_50000', emoji: '💰', label: 'Femti tusen', description: 'Tjent 50 000 kr — strikkeentreprenør!', category: 'marked', tier: 'platinum' },
  { key: 'revenue_100000', emoji: '💰', label: 'Hundre tusen', description: 'Tjent 100 000 kr — strikkeimperiet!', category: 'marked', tier: 'diamond' },

  // ═══════════════════════════════════════════
  // ── Fellesskap ──
  // ═══════════════════════════════════════════

  // Reviews given
  { key: 'first_review', emoji: '⭐', label: 'Anmelder', description: 'Skrev en omtale', category: 'fellesskap' },
  { key: 'reviews_5', emoji: '📣', label: 'Omtaler — Bronse', description: 'Skrevet 5 omtaler', category: 'fellesskap', tier: 'bronze' },
  { key: 'reviews_10', emoji: '📣', label: 'Omtaler — Sølv', description: 'Skrevet 10 omtaler', category: 'fellesskap', tier: 'silver' },
  { key: 'reviews_25', emoji: '📣', label: 'Omtaler — Gull', description: 'Skrevet 25 omtaler', category: 'fellesskap', tier: 'gold' },

  // Reviews received
  { key: 'five_star_review', emoji: '💫', label: 'Strålende', description: 'Fikk en 5-stjerners omtale', category: 'fellesskap' },
  { key: 'avg_rating_5', emoji: '✨', label: 'Perfekt score', description: 'Gjennomsnitt 5.0 med 3+ omtaler', category: 'fellesskap' },
  { key: 'received_reviews_10', emoji: '🌟', label: 'Godt likt — Bronse', description: 'Mottatt 10 omtaler', category: 'fellesskap', tier: 'bronze' },
  { key: 'received_reviews_25', emoji: '🌟', label: 'Godt likt — Sølv', description: 'Mottatt 25 omtaler', category: 'fellesskap', tier: 'silver' },
  { key: 'received_reviews_50', emoji: '🌟', label: 'Godt likt — Gull', description: 'Mottatt 50 omtaler', category: 'fellesskap', tier: 'gold' },

  // Messages
  { key: 'first_message', emoji: '💬', label: 'Isbryter', description: 'Sendte første melding', category: 'fellesskap' },
  { key: 'messages_10', emoji: '💬', label: 'Meldinger — Bronse', description: 'Sendt 10 meldinger', category: 'fellesskap', tier: 'bronze' },
  { key: 'messages_50', emoji: '💬', label: 'Meldinger — Sølv', description: 'Sendt 50 meldinger', category: 'fellesskap', tier: 'silver' },
  { key: 'messages_100', emoji: '💬', label: 'Meldinger — Gull', description: 'Sendt 100 meldinger', category: 'fellesskap', tier: 'gold' },
  { key: 'messages_500', emoji: '💬', label: 'Meldinger — Platina', description: 'Sendt 500 meldinger — superchatter!', category: 'fellesskap', tier: 'platinum' },

  // Patterns
  { key: 'pattern_purchased', emoji: '📄', label: 'Oppskriftsamler', description: 'Kjøpte en oppskrift', category: 'fellesskap' },
  { key: 'patterns_5', emoji: '📚', label: 'Bibliotek — Bronse', description: 'Har 5 oppskrifter i biblioteket', category: 'fellesskap', tier: 'bronze' },
  { key: 'patterns_10', emoji: '📚', label: 'Bibliotek — Sølv', description: 'Har 10 oppskrifter i biblioteket', category: 'fellesskap', tier: 'silver' },
  { key: 'patterns_25', emoji: '📚', label: 'Bibliotek — Gull', description: 'Har 25 oppskrifter i biblioteket', category: 'fellesskap', tier: 'gold' },

  // Trust tiers
  { key: 'trusted_tier', emoji: '🛡️', label: 'Betrodd', description: 'Nådd tillitsnivå «Betrodd»', category: 'fellesskap' },
  { key: 'established_tier', emoji: '🏅', label: 'Etablert', description: 'Nådd tillitsnivå «Etablert»', category: 'fellesskap' },

  // ═══════════════════════════════════════════
  // ── Moderering ──
  // ═══════════════════════════════════════════

  // Decisions
  { key: 'first_moderation', emoji: '⚖️', label: 'Første vurdering', description: 'Vurderte første sak i modereringskøen', category: 'moderering' },
  { key: 'moderations_10', emoji: '⚖️', label: 'Moderering — Bronse', description: 'Vurdert 10 saker', category: 'moderering', tier: 'bronze' },
  { key: 'moderations_25', emoji: '⚖️', label: 'Moderering — Sølv', description: 'Vurdert 25 saker', category: 'moderering', tier: 'silver' },
  { key: 'moderations_50', emoji: '⚖️', label: 'Moderering — Gull', description: 'Vurdert 50 saker', category: 'moderering', tier: 'gold' },
  { key: 'moderations_100', emoji: '⚖️', label: 'Moderering — Platina', description: 'Vurdert 100 saker', category: 'moderering', tier: 'platinum' },
  { key: 'moderations_250', emoji: '⚖️', label: 'Moderering — Diamant', description: 'Vurdert 250 saker — pilaren i fellesskapet!', category: 'moderering', tier: 'diamond' },
  { key: 'moderations_500', emoji: '⚖️', label: 'Moderering — Legendar', description: 'Vurdert 500 saker — uerstattelig', category: 'moderering', tier: 'diamond' },

  // Shadow reviews
  { key: 'first_shadow_confirmed', emoji: '👁️', label: 'Skyggevokter', description: 'Bekreftet første skyggevurdering', category: 'moderering' },
  { key: 'shadow_confirmed_10', emoji: '👁️', label: 'Skygge — Bronse', description: 'Bekreftet 10 skyggevurderinger', category: 'moderering', tier: 'bronze' },
  { key: 'shadow_confirmed_25', emoji: '👁️', label: 'Skygge — Sølv', description: 'Bekreftet 25 skyggevurderinger', category: 'moderering', tier: 'silver' },

  // Escalations
  { key: 'first_escalation', emoji: '🚨', label: 'Varsler', description: 'Eskalerte en sak for grundigere gjennomgang', category: 'moderering' },

  // Streak
  { key: 'mod_streak_7d', emoji: '🔥', label: 'Vaktuke', description: 'Moderert minst én sak per dag i 7 dager', category: 'moderering', tier: 'bronze' },
  { key: 'mod_streak_30d', emoji: '🔥', label: 'Vaktmåned', description: 'Moderert minst én sak per dag i 30 dager', category: 'moderering', tier: 'gold' },
];

export const ACHIEVEMENT_MAP = new Map(ACHIEVEMENTS.map(a => [a.key, a]));

export const CATEGORY_LABELS: Record<string, string> = {
  profil: 'Profil',
  strikking: 'Strikking',
  marked: 'Strikketorget',
  fellesskap: 'Fellesskap',
  moderering: 'Moderering',
};

export async function grantAchievement(admin: SupabaseClient, userId: string, key: string): Promise<boolean> {
  const { error } = await admin
    .from('user_achievements')
    .insert({ user_id: userId, achievement_key: key });
  if (error && error.code === '23505') return false;
  return !error;
}

export interface EarnedAchievement {
  key: string;
  granted_at: string;
}

export async function getUserAchievements(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('user_achievements')
    .select('achievement_key')
    .eq('user_id', userId);
  return (data ?? []).map(r => r.achievement_key);
}

export async function getUserAchievementsWithDates(supabase: SupabaseClient, userId: string): Promise<EarnedAchievement[]> {
  const { data } = await supabase
    .from('user_achievements')
    .select('achievement_key, granted_at')
    .eq('user_id', userId);
  return (data ?? []).map(r => ({ key: r.achievement_key, granted_at: r.granted_at }));
}

export async function checkAndGrantAchievements(admin: SupabaseClient, userId: string, env?: Record<string, string | undefined>): Promise<string[]> {
  const [
    { data: profile },
    { data: existing },
    { data: projects },
    { data: projectLogs },
    { data: listings },
    { data: soldListings },
    { data: purchasedListings },
    { data: commissionRequests },
    { data: offersGiven },
    { data: completedCommissions },
    { data: favorites },
    { data: myListingFavCount },
    { data: reviews },
    { data: receivedReviews },
    { data: messageCount },
    { data: purchases },
    { data: externalPatterns },
    { data: moderationDecisions },
    { data: shadowConfirms },
    { data: escalations },
    { data: revenueData },
  ] = await Promise.all([
    admin.from('profiles')
      .select('created_at, avatar_path, bio, location, instagram_handle, stripe_onboarded, trust_tier, role')
      .eq('id', userId).single(),
    admin.from('user_achievements')
      .select('achievement_key')
      .eq('user_id', userId),
    admin.from('projects')
      .select('id, status, category')
      .eq('user_id', userId),
    admin.from('project_logs')
      .select('id, photos, rows_at')
      .eq('user_id', userId),
    admin.from('listings')
      .select('id, status')
      .eq('seller_id', userId)
      .in('status', ['active', 'sold', 'reserved', 'shipped']),
    admin.from('listings')
      .select('id')
      .eq('seller_id', userId)
      .eq('status', 'sold'),
    admin.from('listings')
      .select('id')
      .eq('buyer_id', userId)
      .in('status', ['sold', 'reserved', 'shipped']),
    admin.from('commission_requests')
      .select('id')
      .eq('buyer_id', userId),
    admin.from('commission_offers')
      .select('id')
      .eq('knitter_id', userId),
    admin.from('commission_requests')
      .select('id, awarded_offer_id, commission_offers!commission_requests_awarded_offer_id_fkey(knitter_id)')
      .in('status', ['delivered', 'completed']),
    admin.from('favorites')
      .select('id')
      .eq('user_id', userId),
    admin.from('listings')
      .select('favorite_count')
      .eq('seller_id', userId),
    admin.from('transaction_reviews')
      .select('id, rating')
      .eq('reviewer_id', userId),
    admin.from('transaction_reviews')
      .select('id, rating')
      .eq('reviewee_id', userId)
      .eq('visible', true),
    admin.from('marketplace_messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_id', userId),
    admin.from('purchases')
      .select('id')
      .eq('user_id', userId),
    admin.from('external_patterns')
      .select('id')
      .eq('user_id', userId),
    admin.from('moderation_queue')
      .select('id, decision_at')
      .eq('decision_by', userId)
      .in('status', ['approved', 'rejected']),
    admin.from('moderation_queue')
      .select('id')
      .eq('shadow_confirmed_by', userId)
      .not('shadow_confirmed_at', 'is', null),
    admin.from('moderation_queue')
      .select('id')
      .eq('decision_by', userId)
      .eq('status', 'escalated'),
    admin.from('listings')
      .select('price_nok')
      .eq('seller_id', userId)
      .eq('status', 'sold'),
  ]);

  if (!profile) return [];

  const has = new Set((existing ?? []).map(e => e.achievement_key));
  const granted: string[] = [];

  async function grant(key: string) {
    if (has.has(key)) return;
    const ok = await grantAchievement(admin, userId, key);
    if (ok) granted.push(key);
    has.add(key);
  }

  const days = (Date.now() - new Date(profile.created_at).getTime()) / 86400_000;

  // ── Profil ──
  if (profile.avatar_path) await grant('first_avatar');
  if (profile.bio && profile.bio.length >= 10) await grant('bio_written');
  if (profile.avatar_path && profile.bio && profile.location && profile.instagram_handle) await grant('full_profile');
  if (profile.instagram_handle) await grant('instagram_linked');
  if (profile.stripe_onboarded) await grant('stripe_onboarded');
  if (days >= 30) await grant('member_30d');
  if (days >= 90) await grant('member_90d');
  if (days >= 180) await grant('member_180d');
  if (days >= 365) await grant('member_365d');
  if (days >= 730) await grant('member_730d');
  if (days >= 1095) await grant('member_1095d');

  // ── Strikking ──
  const allProjects = projects ?? [];
  const finished = allProjects.filter(p => p.status === 'finished');
  const frogged = allProjects.filter(p => p.status === 'frogged');
  if (allProjects.length >= 1) await grant('first_project');
  if (finished.length >= 1) await grant('project_finished');
  if (finished.length >= 3) await grant('projects_3');
  if (finished.length >= 5) await grant('projects_5');
  if (finished.length >= 10) await grant('projects_10');
  if (finished.length >= 25) await grant('projects_25');
  if (finished.length >= 50) await grant('projects_50');
  if (finished.length >= 100) await grant('projects_100');
  if (finished.length >= 250) await grant('projects_250');
  if (frogged.length >= 1) await grant('frogged');
  if (frogged.length >= 5) await grant('frogged_5');
  if (frogged.length >= 10) await grant('frogged_10');

  const logs = projectLogs ?? [];
  if (logs.length >= 1) await grant('first_log');
  if (logs.length >= 10) await grant('logs_10');
  if (logs.length >= 25) await grant('logs_25');
  if (logs.length >= 50) await grant('logs_50');
  if (logs.length >= 100) await grant('logs_100');
  if (logs.length >= 250) await grant('logs_250');

  const logsWithPhotos = logs.filter(l => l.photos && l.photos.length > 0);
  if (logsWithPhotos.length >= 1) await grant('photo_uploaded');
  const totalPhotos = logs.reduce((sum, l) => sum + (l.photos?.length ?? 0), 0);
  if (totalPhotos >= 10) await grant('photos_10');
  if (totalPhotos >= 25) await grant('photos_25');
  if (totalPhotos >= 50) await grant('photos_50');
  if (totalPhotos >= 100) await grant('photos_100');
  if (totalPhotos >= 250) await grant('photos_250');

  if (logs.some(l => l.rows_at !== null)) await grant('row_counter');
  const totalRows = logs.reduce((sum, l) => sum + (l.rows_at ?? 0), 0);
  if (totalRows >= 1000) await grant('rows_1000');
  if (totalRows >= 5000) await grant('rows_5000');
  if (totalRows >= 10000) await grant('rows_10000');
  if (totalRows >= 50000) await grant('rows_50000');
  if (totalRows >= 100000) await grant('rows_100000');

  const finishedCategories = new Set(finished.map(p => p.category).filter(Boolean));
  const allCats = ['genser', 'cardigan', 'lue', 'votter', 'sokker', 'teppe', 'kjole', 'bukser'];
  if (allCats.every(c => finishedCategories.has(c))) await grant('all_categories');

  // ── Marked ──
  const allListings = listings ?? [];
  if (allListings.length >= 1) await grant('first_listing');
  if (allListings.length >= 5) await grant('listings_5');
  if (allListings.length >= 10) await grant('listings_10');
  if (allListings.length >= 25) await grant('listings_25');
  if (allListings.length >= 50) await grant('listings_50');

  const sold = soldListings ?? [];
  if (sold.length >= 1) await grant('first_sale');
  if (sold.length >= 5) await grant('sales_5');
  if (sold.length >= 10) await grant('sales_10');
  if (sold.length >= 25) await grant('sales_25');
  if (sold.length >= 50) await grant('sales_50');
  if (sold.length >= 100) await grant('sales_100');

  const purchased = purchasedListings ?? [];
  if (purchased.length >= 1) await grant('first_purchase');
  if (purchased.length >= 5) await grant('purchases_5');
  if (purchased.length >= 10) await grant('purchases_10');
  if (purchased.length >= 25) await grant('purchases_25');

  const requests = commissionRequests ?? [];
  if (requests.length >= 1) await grant('first_commission');
  if (requests.length >= 5) await grant('commissions_requested_5');
  if (requests.length >= 10) await grant('commissions_requested_10');

  const offers = offersGiven ?? [];
  if (offers.length >= 1) await grant('first_offer');
  if (offers.length >= 5) await grant('offers_5');
  if (offers.length >= 10) await grant('offers_10');
  if (offers.length >= 25) await grant('offers_25');

  const completed = (completedCommissions ?? []).filter(c => {
    const offer = (c as any).commission_offers;
    return offer?.knitter_id === userId;
  });
  if (completed.length >= 1) await grant('commission_completed');
  if (completed.length >= 5) await grant('commissions_5');
  if (completed.length >= 10) await grant('commissions_10');
  if (completed.length >= 25) await grant('commissions_25');
  if (completed.length >= 50) await grant('commissions_50');

  const favs = favorites ?? [];
  if (favs.length >= 1) await grant('first_favorite');
  if (favs.length >= 10) await grant('favorites_10');
  if (favs.length >= 25) await grant('favorites_25');
  if (favs.length >= 50) await grant('favorites_50');
  if (favs.length >= 100) await grant('favorites_100');

  const totalFavs = (myListingFavCount ?? []).reduce((sum, l) => sum + (l.favorite_count ?? 0), 0);
  if (totalFavs >= 1) await grant('got_favorited');
  if (totalFavs >= 10) await grant('got_favorited_10');
  if (totalFavs >= 25) await grant('got_favorited_25');
  if (totalFavs >= 50) await grant('got_favorited_50');
  if (totalFavs >= 100) await grant('got_favorited_100');

  const totalRevenue = (revenueData ?? []).reduce((sum, l) => sum + (l.price_nok ?? 0), 0);
  if (totalRevenue >= 1000) await grant('revenue_1000');
  if (totalRevenue >= 5000) await grant('revenue_5000');
  if (totalRevenue >= 10000) await grant('revenue_10000');
  if (totalRevenue >= 50000) await grant('revenue_50000');
  if (totalRevenue >= 100000) await grant('revenue_100000');

  // ── Fellesskap ──
  const myReviews = reviews ?? [];
  if (myReviews.length >= 1) await grant('first_review');
  if (myReviews.length >= 5) await grant('reviews_5');
  if (myReviews.length >= 10) await grant('reviews_10');
  if (myReviews.length >= 25) await grant('reviews_25');

  const received = receivedReviews ?? [];
  if (received.some(r => r.rating === 5)) await grant('five_star_review');
  if (received.length >= 3) {
    const avg = received.reduce((s, r) => s + r.rating, 0) / received.length;
    if (avg >= 5.0) await grant('avg_rating_5');
  }
  if (received.length >= 10) await grant('received_reviews_10');
  if (received.length >= 25) await grant('received_reviews_25');
  if (received.length >= 50) await grant('received_reviews_50');

  const msgCount = (messageCount as any)?.length ?? 0;
  if (msgCount >= 1 || (messageCount as any)?.count >= 1) await grant('first_message');
  const totalMsgs = typeof (messageCount as any)?.count === 'number' ? (messageCount as any).count : msgCount;
  if (totalMsgs >= 10) await grant('messages_10');
  if (totalMsgs >= 50) await grant('messages_50');
  if (totalMsgs >= 100) await grant('messages_100');
  if (totalMsgs >= 500) await grant('messages_500');

  const pats = purchases ?? [];
  if (pats.length >= 1) await grant('pattern_purchased');
  const totalPatterns = (pats?.length ?? 0) + (externalPatterns?.length ?? 0);
  if (totalPatterns >= 5) await grant('patterns_5');
  if (totalPatterns >= 10) await grant('patterns_10');
  if (totalPatterns >= 25) await grant('patterns_25');

  if (profile.trust_tier === 'established') await grant('established_tier');
  if (profile.trust_tier === 'trusted') await grant('trusted_tier');

  // ── Moderering ──
  const isMod = profile.role === 'admin' || profile.role === 'moderator';
  if (isMod) {
    const modDecisions = moderationDecisions ?? [];
    if (modDecisions.length >= 1) await grant('first_moderation');
    if (modDecisions.length >= 10) await grant('moderations_10');
    if (modDecisions.length >= 25) await grant('moderations_25');
    if (modDecisions.length >= 50) await grant('moderations_50');
    if (modDecisions.length >= 100) await grant('moderations_100');
    if (modDecisions.length >= 250) await grant('moderations_250');
    if (modDecisions.length >= 500) await grant('moderations_500');

    const shadows = shadowConfirms ?? [];
    if (shadows.length >= 1) await grant('first_shadow_confirmed');
    if (shadows.length >= 10) await grant('shadow_confirmed_10');
    if (shadows.length >= 25) await grant('shadow_confirmed_25');

    const esc = escalations ?? [];
    if (esc.length >= 1) await grant('first_escalation');

    // Streak: check last 7 and 30 days of decisions
    if (modDecisions.length >= 7) {
      const decisionDates = modDecisions
        .map(d => (d as any).decision_at)
        .filter(Boolean)
        .map((d: string) => new Date(d).toISOString().slice(0, 10));
      const uniqueDates = new Set(decisionDates);
      const today = new Date();

      let streak7 = true;
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        if (!uniqueDates.has(d.toISOString().slice(0, 10))) { streak7 = false; break; }
      }
      if (streak7) await grant('mod_streak_7d');

      if (modDecisions.length >= 30) {
        let streak30 = true;
        for (let i = 0; i < 30; i++) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          if (!uniqueDates.has(d.toISOString().slice(0, 10))) { streak30 = false; break; }
        }
        if (streak30) await grant('mod_streak_30d');
      }
    }
  }

  for (const key of granted) {
    const def = ACHIEVEMENT_MAP.get(key);
    if (def) {
      await createNotification(admin, {
        userId,
        type: 'achievement_unlocked',
        title: `${def.emoji} Nytt merke opptjent!`,
        body: `Du har låst opp «${def.label}» — ${def.description}`,
        url: '/profil/merker',
      }, env as any);
    }
  }

  return granted;
}
