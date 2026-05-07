import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

const VALID_KIND = new Set(['pre_loved', 'ready_made']);
const VALID_CATEGORY = new Set([
  'genser', 'cardigan', 'lue', 'votter', 'sokker',
  'teppe', 'kjole', 'bukser', 'annet',
]);
const VALID_CONDITION = new Set(['som_ny', 'lite_brukt', 'brukt', 'slitt']);

const toIntOrNull = (v: FormDataEntryValue | null): number | null => {
  if (!v) return null;
  const n = parseInt(v.toString(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn?next=/studio/marked/listing/ny');

  const form = await request.formData();
  const kind = form.get('kind')?.toString() ?? '';
  if (!VALID_KIND.has(kind)) return new Response('Invalid kind', { status: 400 });

  const title = form.get('title')?.toString().trim() ?? '';
  if (!title) return new Response('Title required', { status: 400 });

  const category = form.get('category')?.toString() ?? '';
  if (!VALID_CATEGORY.has(category)) return new Response('Invalid category', { status: 400 });

  const size_label = form.get('size_label')?.toString().trim() ?? '';
  if (!size_label) return new Response('Size required', { status: 400 });

  const price_nok = toIntOrNull(form.get('price_nok'));
  if (price_nok === null) return new Response('Price required', { status: 400 });

  const conditionRaw = form.get('condition')?.toString();
  let condition: string | null = null;
  if (kind === 'pre_loved') {
    if (!conditionRaw || !VALID_CONDITION.has(conditionRaw)) {
      return new Response('Condition required for pre-loved', { status: 400 });
    }
    condition = conditionRaw;
  }

  const description = form.get('description')?.toString().trim() || null;
  const colorway = form.get('colorway')?.toString().trim() || null;
  const pattern_slug = form.get('pattern_slug')?.toString().trim() || null;
  const pattern_external_title = form.get('pattern_external_title')?.toString().trim() || null;
  const size_age_months_min = toIntOrNull(form.get('size_age_months_min'));
  const size_age_months_max = toIntOrNull(form.get('size_age_months_max'));
  const location = form.get('location')?.toString().trim() || null;
  const shipping_info = form.get('shipping_info')?.toString().trim() || null;

  const supabase = createServerSupabase({ request, cookies });
  const { data, error } = await supabase
    .from('listings')
    .insert({
      seller_id: user.id,
      kind,
      title,
      description,
      price_nok,
      size_label,
      size_age_months_min,
      size_age_months_max,
      category,
      condition,
      pattern_slug,
      pattern_external_title,
      colorway,
      location,
      shipping_info,
      status: 'draft',
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('Listing create failed', error);
    return new Response('Could not create listing', { status: 500 });
  }

  return redirect(`/studio/marked/listing/${data.id}`, 303);
};
