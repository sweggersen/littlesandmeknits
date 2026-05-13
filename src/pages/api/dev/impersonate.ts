import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createAdminSupabase, createServerSupabase } from '../../../lib/supabase';

const EMAIL_DOMAIN = '@test.strikketorget.no';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (import.meta.env.PROD) return new Response('Not available', { status: 403 });

  const host = new URL(request.url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.workers.dev')) {
    return new Response('Not available in production', { status: 403 });
  }

  const form = await request.formData();
  const email = form.get('email')?.toString();
  const raw = form.get('next')?.toString() ?? '/marked';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/marked';
  if (!email?.endsWith(EMAIL_DOMAIN)) {
    return new Response('Only test accounts can be impersonated', { status: 400 });
  }

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Service role key not configured', { status: 503 });
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });

  if (linkError || !linkData?.properties?.email_otp) {
    console.error('Impersonate link failed', linkError);
    return new Response('Could not generate login link', { status: 500 });
  }

  const supabase = createServerSupabase({ request, cookies });
  const { error: otpError } = await supabase.auth.verifyOtp({
    email,
    token: linkData.properties.email_otp,
    type: 'magiclink',
  });

  if (otpError) {
    console.error('Impersonate OTP verify failed', otpError);
    return new Response('Could not verify login', { status: 500 });
  }

  return redirect(next, 303);
};
