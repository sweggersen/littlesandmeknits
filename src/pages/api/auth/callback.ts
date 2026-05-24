import type { APIRoute } from 'astro';
import { createServerSupabase, createAdminSupabase } from '../../../lib/supabase';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async ({ request, cookies, redirect, url }) => {
  const code = url.searchParams.get('code');
  const raw = url.searchParams.get('next') ?? '/studio';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/studio';

  if (!code) {
    return redirect('/login?error=missing_code');
  }

  const supabase = createServerSupabase({ request, cookies });
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  // Stamp the profile with consent timestamps from the signup metadata if
  // we haven't already. LoginForm.tsx sets these on the initial OTP call.
  try {
    const userId = data?.user?.id;
    const meta = data?.user?.user_metadata as { age_confirmed_at?: string; tos_accepted_at?: string } | undefined;
    if (userId && meta && (meta.age_confirmed_at || meta.tos_accepted_at)) {
      const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
      const update: Record<string, string> = {};
      if (meta.age_confirmed_at) update.age_confirmed_at = meta.age_confirmed_at;
      if (meta.tos_accepted_at) update.tos_accepted_at = meta.tos_accepted_at;
      if (Object.keys(update).length) {
        await admin.from('profiles').update(update).eq('id', userId);
      }
    }
  } catch { /* non-fatal */ }

  return redirect(next);
};
