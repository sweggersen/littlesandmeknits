import type { APIRoute } from 'astro';
import { env } from '../../../lib/env';
import { createAdminSupabase, createServerSupabase } from '../../../lib/supabase';
import { devToolsBlocked } from '../../../lib/dev-guard';
import { safeInternalPath } from '../../../lib/auth';

// A GET on this endpoint usually means the user hit refresh on the URL.
// Bounce them back to the picker form instead of showing a 404.
export const GET: APIRoute = async ({ redirect }) => redirect('/dev/login', 303);

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const blocked = devToolsBlocked(request);
  if (blocked) return blocked;

  const form = await request.formData();
  const email = form.get('email')?.toString();
  const rawNext = form.get('next')?.toString() ?? '/market';
  const next = safeInternalPath(rawNext, '/market');

  if (!email) {
    return new Response('Email required', { status: 400 });
  }

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return new Response('Service role key not configured', { status: 503 });
  }

  const admin = createAdminSupabase(serviceKey);

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });

  if (error || !data?.properties?.action_link) {
    console.error('Dev login generateLink failed', error);
    return new Response(`Could not generate link: ${error?.message}`, { status: 500 });
  }

  const linkUrl = new URL(data.properties.action_link);
  const tokenHash = linkUrl.searchParams.get('token_hash') ?? linkUrl.hash?.slice(1);

  if (!tokenHash) {
    const token = linkUrl.searchParams.get('token');
    if (token) {
      const supabase = createServerSupabase({ request, cookies });
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: 'magiclink',
      });
      if (verifyErr) {
        return new Response(`Verify failed: ${verifyErr.message}`, { status: 500 });
      }
      return redirect(next, 303);
    }
    return new Response(`No token in link: ${data.properties.action_link}`, { status: 500 });
  }

  const supabase = createServerSupabase({ request, cookies });
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });

  if (verifyErr) {
    return new Response(`Verify failed: ${verifyErr.message}`, { status: 500 });
  }

  // Auto-assign roles for known dev accounts
  const DEV_ROLES: Record<string, string> = {
    'sam.mathias.weggersen@gmail.com': 'admin',
    'nora@test.strikketorget.no': 'admin',
    'kari@test.strikketorget.no': 'moderator',
  };
  const devRole = DEV_ROLES[email.toLowerCase()];
  if (devRole && data.user?.id) {
    await admin.from('profiles').update({ role: devRole as 'admin' | 'moderator' | 'ambassador' }).eq('id', data.user.id);
  }

  return redirect(next, 303);
};
