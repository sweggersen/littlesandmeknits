import type { AstroCookies } from 'astro';
import { getCurrentUser } from '../auth';
import { createServerSupabase, createAdminSupabase } from '../supabase';
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
  return {
    supabase: createServerSupabase({ request, cookies }),
    admin: createAdminSupabase(serviceRoleKey),
    user: { id: user.id, email: user.email },
    env,
  };
}
