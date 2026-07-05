import type { AstroCookies } from 'astro';
import { getCurrentUser, extractBearerToken, resolveUserEmail } from '../auth';
import { createServerSupabase, createAdminSupabase, createTokenSupabase } from '../supabase';
import type { ServiceContext } from './types';

export async function buildServiceContext(
  request: Request,
  cookies: AstroCookies,
): Promise<ServiceContext | null> {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return null;
  const env = import.meta.env;
  let serviceRoleKey: string;
  try {
    const { env: cfEnv } = await import('cloudflare:workers');
    serviceRoleKey = (cfEnv as any).SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  } catch {
    serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  }
  // ctx.supabase is the RLS-respecting client. A Bearer token (mobile/API) gets
  // a token-authed client so RLS runs as that user; otherwise the cookie client.
  const token = extractBearerToken(request);
  return {
    supabase: token ? createTokenSupabase(token) : createServerSupabase({ request, cookies }),
    admin: createAdminSupabase(serviceRoleKey),
    // Real, deliverable email (Vipps logins carry a synthetic auth email but
    // the real one in user_metadata) — so Stripe receipts + notifications reach
    // the user, never a black-hole address. null when we have no real email yet.
    user: { id: user.id, email: resolveUserEmail(user) ?? undefined },
    env,
  };
}
