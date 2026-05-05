import type { APIRoute } from 'astro';
import { createServerSupabase } from '../../../lib/supabase';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const supabase = createServerSupabase({ request, cookies });
  await supabase.auth.signOut();
  const lang = new URL(request.url).pathname.startsWith('/en') ? '/en' : '';
  return redirect(`${lang}/`);
};
