import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });
  const { error } = await supabase.from('needles').delete().eq('id', id);

  if (error) {
    console.error('Needle delete failed', error);
    return new Response('Could not delete needle', { status: 500 });
  }

  return redirect('/studio/pinner', 303);
};
