import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { createServerSupabase } from '../../../lib/supabase';

const VALID_INTERESTS = new Set(['children', 'adult', 'genser', 'cardigan', 'lue', 'votter', 'sokker', 'teppe', 'kjole', 'bukser']);

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const action = String(form.get('action') ?? 'save');
  const interests = form.getAll('interests')
    .map((v) => String(v))
    .filter((v) => VALID_INTERESTS.has(v));

  const supabase = createServerSupabase({ request, cookies });
  await supabase
    .from('profiles')
    .update({
      strikketorget_welcomed_at: new Date().toISOString(),
      marketplace_interests: action === 'skip' ? null : interests,
    })
    .eq('id', user.id);

  return redirect('/market', 303);
};
