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

  // Designated staff personas get their role on login, so "log in as Hanne
  // (moderator)" actually grants moderator access even on a fresh DB (without
  // running seed-world first). Everyone else stays a regular user.
  const localPart = email.split('@')[0];
  const STAFF_ROLE: Record<string, 'moderator' | 'admin'> = { hanne: 'moderator', silje: 'admin' };
  const role = STAFF_ROLE[localPart] ?? null;

  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let user = list?.users?.find((u) => u.email === email);
  if (!user) {
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: localPart },
    });
    if (cErr || !created.user) {
      return new Response(`Create failed: ${cErr?.message}`, { status: 500 });
    }
    user = created.user;
    await admin.from('profiles').upsert({ id: user.id, display_name: localPart, ...(role ? { role } : {}) });
  } else {
    await admin.auth.admin.updateUserById(user.id, { password });
    // Ensure the staff role is set even if a prior cleanup wiped it.
    if (role) await admin.from('profiles').update({ role }).eq('id', user.id);
  }

  const server = createServerSupabase({ request, cookies });
  const { data: signIn, error } = await server.auth.signInWithPassword({ email, password });
  if (error) return new Response(`Sign in failed: ${error.message}`, { status: 500 });

  // Also hand back the access token so callers can exercise the Bearer-auth
  // path (/api/v1/*) the mobile app will use — not just the cookie session.
  return new Response(
    JSON.stringify({ ok: true, user_id: user.id, access_token: signIn.session?.access_token ?? null }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
