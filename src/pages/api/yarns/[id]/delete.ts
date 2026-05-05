import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const yarnId = params.id;
  if (!yarnId) return new Response('Missing id', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });
  const { error } = await supabase.from('yarns').delete().eq('id', yarnId);
  if (error) {
    console.error('Yarn delete failed', error);
    return new Response('Could not delete', { status: 500 });
  }

  return redirect('/studio/garn', 303);
};
