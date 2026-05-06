import type { SupabaseClient } from '@supabase/supabase-js';

type ProjectYarnRow = {
  id: string;
  yarn_id: string;
  grams_used: number;
  deducted_at: string | null;
};

/**
 * Apply or revert grams_used deductions on a project's linked yarns,
 * driven by the project's current status.
 *
 * - Status 'finished' → for each link whose deducted_at is null,
 *   subtract grams_used from yarns.total_grams and stamp deducted_at.
 * - Anything else → for each link whose deducted_at is set, add the
 *   grams back and clear deducted_at.
 *
 * Yarn rows are RLS-scoped to the owner, so this only touches the
 * caller's own stash; an arithmetic floor of 0 prevents negative totals
 * if the user lowered total_grams between deductions.
 */
export async function reconcileYarnDeductions(
  supabase: SupabaseClient,
  projectId: string,
  newStatus: string,
): Promise<void> {
  const { data: links, error } = await supabase
    .from('project_yarns')
    .select('id, yarn_id, grams_used, deducted_at')
    .eq('project_id', projectId);

  if (error || !links) {
    if (error) console.error('reconcileYarnDeductions: select failed', error);
    return;
  }

  const rows = links as ProjectYarnRow[];
  const shouldBeDeducted = newStatus === 'finished';

  for (const link of rows) {
    const isDeducted = link.deducted_at !== null;
    if (shouldBeDeducted === isDeducted) continue;

    const { data: yarn } = await supabase
      .from('yarns')
      .select('total_grams')
      .eq('id', link.yarn_id)
      .maybeSingle();

    const current = (yarn?.total_grams as number | null | undefined) ?? 0;
    const next = shouldBeDeducted
      ? Math.max(0, current - link.grams_used)
      : current + link.grams_used;

    await supabase.from('yarns').update({ total_grams: next }).eq('id', link.yarn_id);
    await supabase
      .from('project_yarns')
      .update({ deducted_at: shouldBeDeducted ? new Date().toISOString() : null })
      .eq('id', link.id);
  }
}
