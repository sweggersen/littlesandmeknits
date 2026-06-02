import type { APIRoute } from 'astro';
import { env } from '../../../lib/env';
import { createServerSupabase, createAdminSupabase } from '../../../lib/supabase';
import { devToolsBlocked } from '../../../lib/dev-guard';

// Dev-only endpoint. Signs in as a @test.strikketorget.no user by setting a
// known password and calling signInWithPassword (which sets the auth cookies).
// Refuses on prod builds and on non-localhost hosts unless DEV_TOOLS=enabled.
export const POST: APIRoute = async ({ request, cookies }) => {
  const blocked = devToolsBlocked(request);
  if (blocked) return blocked;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Service role key not configured', { status: 503 });
  }

  const { email } = await request.json() as { email?: string };
  if (!email?.endsWith('@test.strikketorget.no')) {
    return new Response('Only @test.strikketorget.no emails allowed', { status: 400 });
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const password = 'test-tower-dev-only-pw';

  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let user = list?.users?.find((u) => u.email === email);
  if (!user) {
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: email.split('@')[0] },
    });
    if (cErr || !created.user) {
      return new Response(`Create failed: ${cErr?.message}`, { status: 500 });
    }
    user = created.user;
    await admin.from('profiles').upsert({ id: user.id, display_name: email.split('@')[0] });
  } else {
    await admin.auth.admin.updateUserById(user.id, { password });
  }

  const server = createServerSupabase({ request, cookies });
  const { error } = await server.auth.signInWithPassword({ email, password });
  if (error) return new Response(`Sign in failed: ${error.message}`, { status: 500 });

  return new Response(JSON.stringify({ ok: true, user_id: user.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
