import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createAdminSupabase, createServerSupabase } from '../../../lib/supabase';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (import.meta.env.PROD) {
    return new Response('Dev only', { status: 403 });
  }

  const form = await request.formData();
  const email = form.get('email')?.toString();
  const rawNext = form.get('next')?.toString() ?? '/marked';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/marked';

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
    await admin.from('profiles').update({ role: devRole }).eq('id', data.user.id);
  }

  return redirect(next, 303);
};
