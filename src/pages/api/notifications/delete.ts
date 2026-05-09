import type { APIRoute } from 'astro';
import { createServerSupabase } from '../../../lib/supabase';
import { getCurrentUser } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const form = await request.formData();
  const id = form.get('id')?.toString();
  if (!id) return new Response('Missing id', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });
  await supabase.from('notifications').delete().eq('id', id);

  return redirect('/varsler', 303);
};
