import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../lib/auth';
import { createServerSupabase } from '../../../../lib/supabase';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  // Best-effort cleanup of stored files. RLS on the projects bucket only
  // lets the owner remove paths inside their own user-id-prefixed folder,
  // and `external_patterns` rows are RLS-scoped too.
  const { data: row } = await supabase
    .from('external_patterns')
    .select('file_path, cover_path')
    .eq('id', id)
    .maybeSingle();

  const paths = [row?.file_path, row?.cover_path].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  // Dedupe — file/cover share a path when an image was uploaded as both.
  const unique = Array.from(new Set(paths));
  if (unique.length > 0) {
    await supabase.storage.from('projects').remove(unique);
  }

  const { error } = await supabase.from('external_patterns').delete().eq('id', id);
  if (error) {
    console.error('External pattern delete failed', error);
    return new Response('Could not delete', { status: 500 });
  }

  return redirect('/profil/bibliotek', 303);
};
