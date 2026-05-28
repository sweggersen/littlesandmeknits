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
  detail?: string;
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

  // 1. By vipps_sub. profiles has no email column; fetch the auth user's
  // email separately if we get a hit so we can mint the magic-link OTP.
  const { data: byVipps } = await admin
    .from('profiles')
    .select('id, vipps_sub')
    .eq('vipps_sub', userinfo.sub)
    .maybeSingle();

  let userId = byVipps?.id ?? null;
  let userEmail: string | null = null;
  if (userId) {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    userEmail = authUser?.user?.email ?? null;
  }

  // 2. By auth email — link Vipps to the existing account.
  // profiles doesn't carry email; the canonical email lives on auth.users.
  // listUsers is paginated; we scan up to 1000 which is fine for current scale.
  if (!userId && userinfo.email) {
    const target = userinfo.email.toLowerCase();
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === target);
    if (existing) {
      userId = existing.id;
      userEmail = existing.email ?? target;
      await admin
        .from('profiles')
        .update({ vipps_sub: userinfo.sub, vipps_phone_e164: userinfo.phone_number ?? null })
        .eq('id', userId);
    }
  }

  // 3. Create new user.
  // We *always* use a synthetic email keyed on the Vipps sub, even when
  // Vipps gives us a real email. This avoids email-format edge cases that
  // can make Supabase's signup email check error out ("Database error
  // checking email"), and guarantees idempotency: re-running this flow
  // with the same Vipps account hits the same auth.users row.
  // The real Vipps email is preserved in user_metadata for display.
  if (!userId) {
    const safeSub = userinfo.sub.replace(/[^a-z0-9-]/gi, '').toLowerCase();
    const synthEmail = `vipps-${safeSub}@vipps.users.littlesandmeknits.com`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: synthEmail,
      email_confirm: true,
      user_metadata: {
        provider: 'vipps',
        vipps_sub: userinfo.sub,
        vipps_email: userinfo.email,
        first_name: userinfo.given_name,
        last_name: userinfo.family_name,
        full_name: userinfo.name,
        phone: userinfo.phone_number,
      },
    });
    if (createErr || !created.user) {
      console.error('Vipps create user failed', createErr);
      return {
        ok: false,
        reason: 'create',
        detail: createErr?.message ?? 'unknown',
      };
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
