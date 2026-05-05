import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const projectId = params.id;
  if (!projectId) return new Response('Missing project', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });
  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  if (error) {
    console.error('Project delete failed', error);
    return new Response('Could not delete', { status: 500 });
  }

  return redirect('/studio/prosjekter', 303);
};
