import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';
import { reconcileYarnDeductions } from '../../../../lib/yarn-deduction';

const toIntOrNull = (v: FormDataEntryValue | null): number | null => {
  if (!v) return null;
  const n = parseInt(v.toString(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const projectId = params.id;
  if (!projectId) return new Response('Missing project', { status: 400 });

  const form = await request.formData();
  const yarn_id = form.get('yarn_id')?.toString().trim();
  const grams_used = toIntOrNull(form.get('grams_used'));
  if (!yarn_id || grams_used === null) {
    return new Response('Yarn and grams required', { status: 400 });
  }

  const supabase = createServerSupabase({ request, cookies });

  // Upsert the link — replacing grams_used if the same yarn was attached
  // already. If the project is currently 'finished' and the link existed,
  // we revert the prior deduction first so reconcile can re-apply with
  // the new grams.
  const { data: existing } = await supabase
    .from('project_yarns')
    .select('id, grams_used, deducted_at')
    .eq('project_id', projectId)
    .eq('yarn_id', yarn_id)
    .maybeSingle();

  if (existing) {
    if (existing.deducted_at) {
      // Roll back the previous deduction before swapping in the new amount.
      const { data: yarn } = await supabase
        .from('yarns')
        .select('total_grams')
        .eq('id', yarn_id)
        .maybeSingle();
      const current = (yarn?.total_grams as number | null | undefined) ?? 0;
      await supabase
        .from('yarns')
        .update({ total_grams: current + (existing.grams_used as number) })
        .eq('id', yarn_id);
    }
    await supabase
      .from('project_yarns')
      .update({ grams_used, deducted_at: null })
      .eq('id', existing.id);
  } else {
    const { error: insErr } = await supabase
      .from('project_yarns')
      .insert({ project_id: projectId, yarn_id, grams_used });
    if (insErr) {
      console.error('Project yarn insert failed', insErr);
      return new Response('Could not attach yarn', { status: 500 });
    }
  }

  // Re-apply deduction state from the project's current status.
  const { data: project } = await supabase
    .from('projects')
    .select('status')
    .eq('id', projectId)
    .maybeSingle();
  await reconcileYarnDeductions(supabase, projectId, (project?.status as string) ?? 'planning');

  return redirect(`/studio/prosjekter/${projectId}`, 303);
};
