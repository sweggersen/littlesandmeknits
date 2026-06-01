import type { APIRoute } from 'astro';
import { createServerSupabase, createAdminSupabase } from '../../../lib/supabase';
import { env } from '../../../lib/env';
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

  // Persist signup metadata into profiles. LoginForm sets:
  //   age_confirmed_at, tos_accepted_at — always on signup
  //   first_name, last_name, display_name — password-signup only
  //   marketing_consent_at — null if user unticked the marketing toggle
  try {
    const meta = data?.user?.user_metadata as Record<string, unknown> | undefined;
    if (userId && meta) {
      const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
      const update: Record<string, unknown> = {};
      if (typeof meta.age_confirmed_at === 'string') update.age_confirmed_at = meta.age_confirmed_at;
      if (typeof meta.tos_accepted_at === 'string') update.tos_accepted_at = meta.tos_accepted_at;
      if (typeof meta.first_name === 'string') update.first_name = meta.first_name;
      if (typeof meta.last_name === 'string') update.last_name = meta.last_name;
      if (typeof meta.display_name === 'string') update.display_name = meta.display_name;
      // marketing_consent_at can be null (user opted out) or a timestamp.
      if (meta.marketing_consent_at === null || typeof meta.marketing_consent_at === 'string') {
        update.marketing_consent_at = meta.marketing_consent_at;
      }
      if (Object.keys(update).length) {
        await admin.from('profiles').update(update).eq('id', userId);
      }
    }
  } catch { /* non-fatal */ }

  // First-login welcome email + birthday-prompt redirect. Both are
  // gated on welcomed_at being null (i.e., this is the user's first
  // successful login).
  let promptBirthday = false;
  if (userId && userEmail) {
    try {
      const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
      const { data: profile } = await admin
        .from('profiles')
        .select('display_name, welcomed_at, birthday')
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
        // First-login users without a birthday → show the onboarding step.
        if (!profile.birthday) promptBirthday = true;
      }
    } catch (e) {
      console.error('welcome email failed', e);
    }
  }

  if (promptBirthday) {
    return redirect(`/onboarding/birthday?next=${encodeURIComponent(next)}`);
  }
  return redirect(next);
};
