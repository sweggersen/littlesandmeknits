import type { APIRoute } from 'astro';
import { env as cfEnv } from 'cloudflare:workers';
import { requireModerator } from '../../../lib/admin-auth';
import { sendEmail } from '../../../lib/email';
import { EMAIL_SAMPLES } from '../../../lib/email-samples';
import { createServerSupabase } from '../../../lib/supabase';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireModerator(request, cookies);
  if (!auth) return new Response('Forbidden', { status: 403 });

  const userEmail = auth.user.email;
  if (!userEmail) return new Response('No email on file', { status: 400 });

  const form = await request.formData();
  const templateKey = (form.get('template') ?? '').toString();
  const sample = EMAIL_SAMPLES[templateKey];
  if (!sample) return redirect('/admin?email_test=unknown');

  const apiKey = (cfEnv as any).RESEND_API_KEY ?? import.meta.env.RESEND_API_KEY;
  if (!apiKey) return redirect('/admin?email_test=no_api_key');

  const supabase = createServerSupabase({ request, cookies });
  const { data: profile } = await supabase
    .from('profiles').select('display_name').eq('id', auth.user.id).maybeSingle();

  const siteUrl = (cfEnv as any).PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? 'http://localhost:4321';
  const { subject, html } = sample(siteUrl, profile?.display_name);
  const sent = await sendEmail(apiKey, { to: userEmail, subject, html });

  return redirect(sent ? `/admin?email_test=sent&template=${templateKey}` : '/admin?email_test=failed');
};
