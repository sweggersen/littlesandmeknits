import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

const VALID_CATEGORY = new Set([
  'genser', 'cardigan', 'lue', 'votter', 'sokker',
  'teppe', 'kjole', 'bukser', 'annet',
]);

const toIntOrNull = (v: FormDataEntryValue | null): number | null => {
  if (!v) return null;
  const n = parseInt(v.toString(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn?next=/marked/oppdrag/ny');

  const form = await request.formData();

  const title = form.get('title')?.toString().trim() ?? '';
  if (!title) return new Response('Tittel er påkrevd', { status: 400 });

  const category = form.get('category')?.toString() ?? '';
  if (!VALID_CATEGORY.has(category)) return new Response('Ugyldig kategori', { status: 400 });

  const size_label = form.get('size_label')?.toString().trim() ?? '';
  if (!size_label) return new Response('Størrelse er påkrevd', { status: 400 });

  const budget_nok_min = toIntOrNull(form.get('budget_nok_min'));
  const budget_nok_max = toIntOrNull(form.get('budget_nok_max'));
  if (budget_nok_min === null || budget_nok_max === null) {
    return new Response('Budsjett er påkrevd', { status: 400 });
  }
  if (budget_nok_max < budget_nok_min) {
    return new Response('Maks budsjett må være høyere enn minimum', { status: 400 });
  }

  const description = form.get('description')?.toString().trim() || null;
  const colorway = form.get('colorway')?.toString().trim() || null;
  const pattern_external_title = form.get('pattern_external_title')?.toString().trim() || null;
  const yarn_preference = form.get('yarn_preference')?.toString().trim() || null;
  const yarn_provided_by_buyer = form.get('yarn_provided_by_buyer') === '1';
  const needed_by = form.get('needed_by')?.toString() || null;
  const size_age_months_min = toIntOrNull(form.get('size_age_months_min'));
  const size_age_months_max = toIntOrNull(form.get('size_age_months_max'));
  const target_knitter_id = form.get('target_knitter_id')?.toString().trim() || null;

  const supabase = createServerSupabase({ request, cookies });
  const { data, error } = await supabase
    .from('commission_requests')
    .insert({
      buyer_id: user.id,
      title,
      description,
      category,
      size_label,
      size_age_months_min,
      size_age_months_max,
      colorway,
      pattern_external_title,
      yarn_preference,
      yarn_provided_by_buyer,
      budget_nok_min,
      budget_nok_max,
      needed_by,
      target_knitter_id,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('Commission request create failed', JSON.stringify(error));
    return new Response(`Kunne ikke opprette forespørsel: ${error?.message ?? 'unknown'}`, { status: 500 });
  }

  return redirect(`/marked/oppdrag/${data.id}`, 303);
};
