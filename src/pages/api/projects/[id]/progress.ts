import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

function parseInt0OrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.toString().trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const projectId = params.id;
  if (!projectId) return new Response('Missing project', { status: 400 });

  const form = await request.formData();
  const target = parseInt0OrNull(form.get('target_rows')?.toString());
  const current = parseInt0OrNull(form.get('current_rows')?.toString());

  // Cap at 100k rows; that's a generous upper bound that still lets us catch typos.
  const capped = (n: number | null) => (n !== null && n > 100000 ? 100000 : n);

  const supabase = createServerSupabase({ request, cookies });
  const { error } = await supabase
    .from('projects')
    .update({ target_rows: capped(target), current_rows: capped(current) })
    .eq('id', projectId);

  if (error) {
    console.error('Progress update failed', error);
    return new Response('Could not update', { status: 500 });
  }

  return redirect(`/studio/prosjekter/${projectId}`, 303);
};
