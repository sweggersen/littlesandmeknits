import type { AstroCookies } from 'astro';
import { getCurrentUser } from './auth';
import { createServerSupabase } from './supabase';

export type UserRole = 'admin' | 'moderator' | 'ambassador';

interface AuthResult {
  user: { id: string; email?: string };
  role: UserRole;
}

async function getProfileRole(request: Request, cookies: AstroCookies) {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return null;

  const supabase = createServerSupabase({ request, cookies });
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!data?.role) return null;
  return { user: { id: user.id, email: user.email }, role: data.role as UserRole };
}

export async function requireAdmin(request: Request, cookies: AstroCookies): Promise<AuthResult | null> {
  const result = await getProfileRole(request, cookies);
  if (!result || result.role !== 'admin') return null;
  return result;
}

export async function requireModerator(request: Request, cookies: AstroCookies): Promise<AuthResult | null> {
  const result = await getProfileRole(request, cookies);
  if (!result || (result.role !== 'admin' && result.role !== 'moderator')) return null;
  return result;
}

export async function requireRole(request: Request, cookies: AstroCookies, roles: UserRole[]): Promise<AuthResult | null> {
  const result = await getProfileRole(request, cookies);
  if (!result || !roles.includes(result.role)) return null;
  return result;
}

/** Shadow-eligible: passed the initial 50-review training period AND has
 *  a clean override record. Eligible moderators can confirm OTHER
 *  moderators' shadow decisions in addition to admins. */
export const SHADOW_ELIGIBLE_MIN_REVIEWS = 50;
export const SHADOW_ELIGIBLE_MAX_OVERRIDES = 3;

export interface ShadowEligibilityStats {
  total_reviews: number;
  shadow_overrides: number;
}

export function isShadowEligible(
  role: UserRole | null | undefined,
  stats: ShadowEligibilityStats | null | undefined,
): boolean {
  if (role === 'admin') return true;
  if (role !== 'moderator') return false;
  const reviews = stats?.total_reviews ?? 0;
  const overrides = stats?.shadow_overrides ?? 0;
  return reviews >= SHADOW_ELIGIBLE_MIN_REVIEWS && overrides <= SHADOW_ELIGIBLE_MAX_OVERRIDES;
}
