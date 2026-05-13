import type { SupabaseClient } from '@supabase/supabase-js';
import { getReviewStats } from './moderation';

export type TrustTier = 'new' | 'established' | 'trusted';

interface TrustInput {
  created_at: string;
  avatar_path: string | null;
  bio: string | null;
  location: string | null;
  instagram_handle: string | null;
  stripe_onboarded: boolean;
  total_completed_transactions: number;
  total_rejections: number;
}

export function computeTrustScore(profile: TrustInput, reviewStats: { avg_rating: number; review_count: number }): number {
  let score = 0;

  const days = (Date.now() - new Date(profile.created_at).getTime()) / 86400_000;
  if (days >= 365) score += 15;
  else if (days >= 180) score += 12;
  else if (days >= 90) score += 9;
  else if (days >= 30) score += 5;
  else if (days >= 7) score += 2;

  if (profile.avatar_path) score += 5;
  if (profile.bio && profile.bio.length >= 20) score += 5;
  if (profile.location) score += 5;
  if (profile.instagram_handle) score += 5;

  if (profile.stripe_onboarded) score += 10;

  const txn = profile.total_completed_transactions;
  if (txn >= 10) score += 25;
  else if (txn >= 5) score += 20;
  else if (txn >= 3) score += 15;
  else if (txn >= 1) score += 8;

  if (reviewStats.avg_rating >= 4.5 && reviewStats.review_count >= 3) score += 15;
  else if (reviewStats.avg_rating >= 4.0 && reviewStats.review_count >= 2) score += 10;
  else if (reviewStats.avg_rating >= 3.0 && reviewStats.review_count >= 1) score += 5;

  score -= Math.min(profile.total_rejections * 5, 20);

  return Math.max(0, Math.min(100, score));
}

export function determineTier(score: number, profile: TrustInput): TrustTier {
  const days = (Date.now() - new Date(profile.created_at).getTime()) / 86400_000;

  if (score >= 70 && profile.total_completed_transactions >= 5 && days >= 90 && profile.total_rejections === 0) {
    return 'trusted';
  }
  if (score >= 40 && profile.total_completed_transactions >= 2 && days >= 30 && profile.total_rejections < 3) {
    return 'established';
  }
  return 'new';
}

export async function recalculateTrust(admin: SupabaseClient, userId: string): Promise<{ score: number; tier: TrustTier }> {
  const { data: profile } = await admin
    .from('profiles')
    .select('created_at, avatar_path, bio, location, instagram_handle, stripe_onboarded, total_completed_transactions, total_rejections')
    .eq('id', userId)
    .single();

  if (!profile) return { score: 0, tier: 'new' };

  const reviewStats = await getReviewStats(admin, userId);
  const score = computeTrustScore(profile, reviewStats);
  const tier = determineTier(score, profile);

  await admin
    .from('profiles')
    .update({ trust_score: score, trust_tier: tier })
    .eq('id', userId);

  return { score, tier };
}
