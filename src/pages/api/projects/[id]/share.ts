import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';
import { slugify, randomSuffix } from '../../../../lib/slug';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const projectId = params.id;
  if (!projectId) return new Response('Missing project', { status: 400 });

  const form = await request.formData();
  const wantShare = form.get('share')?.toString() === 'true';

  const supabase = createServerSupabase({ request, cookies });

  if (!wantShare) {
    const { error } = await supabase
      .from('projects')
      .update({ public_slug: null })
      .eq('id', projectId);
    if (error) {
      console.error('Unshare failed', error);
      return new Response('Could not update', { status: 500 });
    }
    return redirect(`/studio/prosjekter/${projectId}`, 303);
  }

  const { data: project, error: fetchErr } = await supabase
    .from('projects')
    .select('id, title, public_slug')
    .eq('id', projectId)
    .maybeSingle();
  if (fetchErr || !project) return new Response('Not found', { status: 404 });

  if (project.public_slug) {
    return redirect(`/studio/prosjekter/${projectId}`, 303);
  }

  // Try slugified title first, append random suffix on collision.
  const base = slugify(project.title);
  let attempt = `${base}-${randomSuffix(4)}`;
  for (let i = 0; i < 5; i++) {
    const { error: upErr } = await supabase
      .from('projects')
      .update({ public_slug: attempt })
      .eq('id', projectId);
    if (!upErr) break;
    attempt = `${base}-${randomSuffix(6)}`;
    if (i === 4) {
      console.error('Share slug collision exhausted', upErr);
      return new Response('Could not generate share link', { status: 500 });
    }
  }

  return redirect(`/studio/prosjekter/${projectId}`, 303);
};
