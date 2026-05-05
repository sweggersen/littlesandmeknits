import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { createServerSupabase, createAdminSupabase } from '../../../lib/supabase';

export const GET: APIRoute = async ({ params, request, cookies, locals }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return new Response('Unauthorized', { status: 401 });

  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  // Use the user's own session to read the purchase row (RLS enforces ownership).
  const userClient = createServerSupabase({ request, cookies });
  const { data: purchase, error } = await userClient
    .from('purchases')
    .select('id, pdf_path, status, user_id')
    .eq('id', id)
    .eq('status', 'completed')
    .maybeSingle();

  if (error || !purchase || !purchase.pdf_path) {
    return new Response('Not found', { status: 404 });
  }
  if (purchase.user_id !== user.id) {
    return new Response('Forbidden', { status: 403 });
  }

  const env = locals.runtime.env;
  if (!env?.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Server not configured', { status: 503 });
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: signed, error: signErr } = await admin.storage
    .from('patterns')
    .createSignedUrl(purchase.pdf_path, 60);

  if (signErr || !signed?.signedUrl) {
    console.error('Signed URL failed', signErr);
    return new Response('Could not generate download', { status: 500 });
  }

  return Response.redirect(signed.signedUrl, 302);
};
