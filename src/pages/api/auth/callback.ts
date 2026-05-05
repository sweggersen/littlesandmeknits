import type { APIRoute } from 'astro';
import { createServerSupabase } from '../../../lib/supabase';

export const GET: APIRoute = async ({ request, cookies, redirect, url }) => {
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/studio';

  if (!code) {
    return redirect('/logg-inn?error=missing_code');
  }

  const supabase = createServerSupabase({ request, cookies });
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirect(`/logg-inn?error=${encodeURIComponent(error.message)}`);
  }

  return redirect(next);
};
