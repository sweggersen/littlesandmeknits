import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { sendEmail } from '../email';
import { EMAIL_SAMPLES } from '../email-samples';

/** Moderator-only diagnostic: render a sample email template and send
 *  it to the calling moderator's own email. Used from /admin to verify
 *  template rendering + Resend wiring after copy changes. */
export async function sendTestEmail(
  ctx: ServiceContext,
  input: { templateKey: string },
): Promise<ServiceResult<{ redirect: string }>> {
  // Role check belongs here, not in the route.
  const { data: prof } = await ctx.admin
    .from('profiles').select('role, display_name')
    .eq('id', ctx.user.id).maybeSingle();
  if (!prof || (prof.role !== 'admin' && prof.role !== 'moderator')) {
    return fail('forbidden', 'Moderator-only action');
  }
  if (!ctx.user.email) return fail('bad_input', 'No email on file');

  const sample = EMAIL_SAMPLES[input.templateKey];
  if (!sample) return ok({ redirect: '/admin?email_test=unknown' });

  const apiKey = ctx.env.RESEND_API_KEY;
  if (!apiKey) return ok({ redirect: '/admin?email_test=no_api_key' });

  const siteUrl = ctx.env.PUBLIC_SITE_URL ?? 'http://localhost:4321';
  const { subject, html } = sample(siteUrl, prof.display_name ?? undefined);
  const sent = await sendEmail(apiKey, { to: ctx.user.email, subject, html });

  return ok({
    redirect: sent
      ? `/admin?email_test=sent&template=${input.templateKey}`
      : '/admin?email_test=failed',
  });
}
