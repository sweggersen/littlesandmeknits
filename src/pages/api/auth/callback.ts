import type { APIRoute } from 'astro';
import { createServerSupabase, createAdminSupabase } from '../../../lib/supabase';
import { env } from 'cloudflare:workers';
import { sendEmail } from '../../../lib/email';
import { renderWelcomeEmail } from '../../../lib/email-templates';

export const GET: APIRoute = async ({ request, cookies, redirect, url }) => {
  const code = url.searchParams.get('code');
  const raw = url.searchParams.get('next') ?? '/studio';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/studio';

  if (!code) {
    return redirect('/login?error=missing_code');
  }

  const supabase = createServerSupabase({ request, cookies });
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  const userId = data?.user?.id;
  const userEmail = data?.user?.email;

  // Stamp the profile with consent timestamps from the signup metadata if
  // we haven't already. LoginForm.tsx sets these on the initial OTP call.
  try {
    const meta = data?.user?.user_metadata as { age_confirmed_at?: string; tos_accepted_at?: string } | undefined;
    if (userId && meta && (meta.age_confirmed_at || meta.tos_accepted_at)) {
      const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
      const update: Record<string, string> = {};
      if (meta.age_confirmed_at) update.age_confirmed_at = meta.age_confirmed_at;
      if (meta.tos_accepted_at) update.tos_accepted_at = meta.tos_accepted_at;
      if (Object.keys(update).length) {
        await admin.from('profiles').update(update).eq('id', userId);
      }
    }
  } catch { /* non-fatal */ }

  // First-login welcome email. Idempotent via profiles.welcomed_at.
  if (userId && userEmail) {
    try {
      const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
      const { data: profile } = await admin
        .from('profiles')
        .select('display_name, welcomed_at')
        .eq('id', userId)
        .maybeSingle();

      if (profile && !profile.welcomed_at) {
        const apiKey = (env as any).RESEND_API_KEY;
        const siteUrl = (env as any).PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
        if (apiKey) {
          const { subject, html } = renderWelcomeEmail({
            name: profile.display_name,
            siteUrl,
          });
          const sent = await sendEmail(apiKey, { to: userEmail, subject, html });
          if (sent) {
            await admin.from('profiles')
              .update({ welcomed_at: new Date().toISOString() })
              .eq('id', userId);
          }
        }
      }
    } catch (e) {
      console.error('welcome email failed', e);
    }
  }

  return redirect(next);
};
