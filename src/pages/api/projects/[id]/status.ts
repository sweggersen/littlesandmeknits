import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';
import { reconcileYarnDeductions } from '../../../../lib/yarn-deduction';

const VALID_STATUS = new Set(['planning', 'active', 'finished', 'frogged']);

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const projectId = params.id;
  if (!projectId) return new Response('Missing project', { status: 400 });

  const form = await request.formData();
  const status = form.get('status')?.toString() ?? '';
  if (!VALID_STATUS.has(status)) return new Response('Invalid status', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  type Patch = {
    status: string;
    finished_at?: string | null;
  };
  const patch: Patch = { status };
  if (status === 'finished') {
    patch.finished_at = new Date().toISOString().slice(0, 10);
  } else if (status === 'planning' || status === 'active' || status === 'frogged') {
    patch.finished_at = null;
  }

  const { error } = await supabase.from('projects').update(patch).eq('id', projectId);
  if (error) {
    console.error('Status update failed', error);
    return new Response('Could not update', { status: 500 });
  }

  // Apply or revert yarn-stash deductions for any linked yarns.
  await reconcileYarnDeductions(supabase, projectId, status);

  return redirect(`/studio/prosjekter/${projectId}`, 303);
};
