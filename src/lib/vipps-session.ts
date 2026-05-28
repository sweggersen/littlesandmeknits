// Shared find-or-create-user logic used by both the real Vipps callback
// and the dev-mode simulator. Given a userinfo blob from Vipps (real or
// faked), this links it to a Supabase auth user and mints a session by
// redeeming a one-time magic link token through the cookie-bound client.

import type { AstroCookies } from 'astro';
import type { VippsUserinfo } from './vipps';
import { createServerSupabase, createAdminSupabase } from './supabase';

export interface SignInResult {
  ok: boolean;
  reason?: string;
}

export async function signInWithVippsUserinfo(opts: {
  userinfo: VippsUserinfo;
  request: Request;
  cookies: AstroCookies;
  serviceRoleKey: string;
}): Promise<SignInResult> {
  const { userinfo, request, cookies, serviceRoleKey } = opts;
  if (!userinfo.sub) return { ok: false, reason: 'no-sub' };

  const admin = createAdminSupabase(serviceRoleKey);

  // 1. By vipps_sub
  const { data: byVipps } = await admin
    .from('profiles')
    .select('id, email, vipps_sub')
    .eq('vipps_sub', userinfo.sub)
    .maybeSingle();

  let userId = byVipps?.id ?? null;
  let userEmail = byVipps?.email ?? null;

  // 2. By email — link Vipps to the existing account
  if (!userId && userinfo.email) {
    const { data: byEmail } = await admin
      .from('profiles')
      .select('id, email')
      .eq('email', userinfo.email.toLowerCase())
      .maybeSingle();
    if (byEmail?.id) {
      userId = byEmail.id;
      userEmail = byEmail.email;
      await admin
        .from('profiles')
        .update({ vipps_sub: userinfo.sub, vipps_phone_e164: userinfo.phone_number ?? null })
        .eq('id', userId);
    }
  }

  // 3. Create new user
  if (!userId) {
    const synthEmail = userinfo.email
      ? userinfo.email.toLowerCase()
      : `vipps-${userinfo.sub}@vipps.users.littlesandmeknits.com`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: synthEmail,
      email_confirm: true,
      user_metadata: {
        provider: 'vipps',
        vipps_sub: userinfo.sub,
        first_name: userinfo.given_name,
        last_name: userinfo.family_name,
        full_name: userinfo.name,
        phone: userinfo.phone_number,
      },
    });
    if (createErr || !created.user) {
      console.error('Vipps create user failed', createErr);
      return { ok: false, reason: 'create' };
    }
    userId = created.user.id;
    userEmail = synthEmail;

    await admin
      .from('profiles')
      .update({
        vipps_sub: userinfo.sub,
        vipps_phone_e164: userinfo.phone_number ?? null,
        first_name: userinfo.given_name ?? null,
        last_name: userinfo.family_name ?? null,
        display_name: userinfo.name ?? null,
        email: synthEmail,
      })
      .eq('id', userId);
  }

  if (!userId || !userEmail) return { ok: false, reason: 'no-user' };

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: userEmail,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    console.error('Vipps generateLink failed', linkErr);
    return { ok: false, reason: 'link' };
  }

  const supabase = createServerSupabase({ request, cookies });
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  });
  if (verifyErr) {
    console.error('Vipps verifyOtp failed', verifyErr);
    return { ok: false, reason: 'verify' };
  }

  return { ok: true };
}
