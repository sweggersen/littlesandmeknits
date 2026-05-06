import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../../../lib/auth';
import { createServerSupabase } from '../../../../../../lib/supabase';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const projectId = params.id;
  const linkId = params.linkId;
  if (!projectId || !linkId) return new Response('Missing ids', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  // If the link's deduction is currently applied, restore the grams to
  // the yarn before removing the row — otherwise the stash would
  // permanently lose grams that the user no longer wants attributed.
  const { data: link } = await supabase
    .from('project_yarns')
    .select('yarn_id, grams_used, deducted_at')
    .eq('id', linkId)
    .maybeSingle();

  if (link?.deducted_at && link.yarn_id && typeof link.grams_used === 'number') {
    const { data: yarn } = await supabase
      .from('yarns')
      .select('total_grams')
      .eq('id', link.yarn_id)
      .maybeSingle();
    const current = (yarn?.total_grams as number | null | undefined) ?? 0;
    await supabase
      .from('yarns')
      .update({ total_grams: current + link.grams_used })
      .eq('id', link.yarn_id);
  }

  const { error } = await supabase.from('project_yarns').delete().eq('id', linkId);
  if (error) {
    console.error('Project yarn delete failed', error);
    return new Response('Could not detach yarn', { status: 500 });
  }

  return redirect(`/studio/prosjekter/${projectId}`, 303);
};
