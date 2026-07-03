import type { AstroCookies } from 'astro';
import { getCurrentUser, extractBearerToken } from '../auth';
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
    user: { id: user.id, email: user.email },
    env,
  };
}
