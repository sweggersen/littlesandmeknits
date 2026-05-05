import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const projectId = params.id;
  if (!projectId) return new Response('Missing project', { status: 400 });

  const form = await request.formData();
  const body = form.get('body')?.toString().trim();
  if (!body) return new Response('Body required', { status: 400 });

  const rawDate = form.get('log_date')?.toString();
  const log_date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);

  const supabase = createServerSupabase({ request, cookies });
  const { error } = await supabase.from('project_logs').insert({
    project_id: projectId,
    user_id: user.id,
    body,
    log_date,
  });

  if (error) {
    console.error('Log insert failed', error);
    return new Response('Could not save log', { status: 500 });
  }

  return redirect(`/studio/prosjekter/${projectId}`, 303);
};
