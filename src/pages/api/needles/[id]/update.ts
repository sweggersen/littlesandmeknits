import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

const VALID_TYPES = new Set(['circular', 'dpn', 'straight']);

const toFloatOrNull = (v: FormDataEntryValue | null): number | null => {
  if (!v) return null;
  const n = parseFloat(v.toString().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const toIntOrNull = (v: FormDataEntryValue | null): number | null => {
  if (!v) return null;
  const n = parseInt(v.toString(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  const form = await request.formData();
  const needle_type = form.get('needle_type')?.toString().trim() ?? '';
  if (!VALID_TYPES.has(needle_type)) return new Response('Invalid type', { status: 400 });

  const size_mm = toFloatOrNull(form.get('size_mm'));
  if (size_mm === null) return new Response('Size required', { status: 400 });

  const length_cm = toIntOrNull(form.get('length_cm'));
  const material = form.get('material')?.toString().trim() || null;
  const brand = form.get('brand')?.toString().trim() || null;
  const notes = form.get('notes')?.toString().trim() || null;

  const supabase = createServerSupabase({ request, cookies });
  const { error } = await supabase
    .from('needles')
    .update({ needle_type, size_mm, length_cm, material, brand, notes })
    .eq('id', id);

  if (error) {
    console.error('Needle update failed', error);
    return new Response('Could not update needle', { status: 500 });
  }

  return redirect(`/studio/pinner/${id}`, 303);
};
