import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCurrentUser } from '../../../lib/auth';
import { createAdminSupabase } from '../../../lib/supabase';

const EMAIL_DOMAIN = '@test.strikketorget.no';
const ADMIN_EMAIL = 'ammon.weggersen@gmail.com';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user || user.email !== ADMIN_EMAIL) {
    return new Response('Forbidden', { status: 403 });
  }

  const form = await request.formData();
  const email = form.get('email')?.toString();
  if (!email?.endsWith(EMAIL_DOMAIN)) {
    return new Response('Only test accounts can be impersonated', { status: 400 });
  }

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Service role key not configured', { status: 503 });
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${siteUrl}/marked` },
  });

  if (error || !data?.properties?.action_link) {
    console.error('Impersonate link failed', error);
    return new Response('Could not generate login link', { status: 500 });
  }

  return redirect(data.properties.action_link, 303);
};
