// Token-based email invitations to join a store. Mobile-friendly: the accept
// link works in any browser (HTML page) and the accept API takes JSON.

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { can, canAssignRole, ROLE_LABEL_NB } from './store-permissions';
import { getMyRole } from './store-members';
import { createNotification } from '../notify';
import type { StoreRole } from '../types/stores';

const INVITE_TTL_DAYS = 14;

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function inviteMember(
  ctx: ServiceContext,
  storeId: string,
  input: { email: string; role: StoreRole },
): Promise<ServiceResult<{ token: string; inviteUrl: string }>> {
  const myRole = await getMyRole(ctx, storeId);
  if (!can.inviteMembers(myRole)) return fail('forbidden', 'Ikke tilgang');
  if (!canAssignRole(myRole, input.role)) return fail('forbidden', 'Kan ikke tildele denne rollen');

  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('bad_input', 'Ugyldig e-post');

  // Find the invited user by email (used for the already-member check + the
  // in-app notification). listUsers has no direct by-email filter, so page
  // through a large batch — perPage:1 (the old value) returned a single user and
  // silently missed almost everyone. TODO: admin.auth.getUserByEmail when avail.
  const { data: existingUser } = await ctx.admin.auth.admin.listUsers({ perPage: 1000 });
  const userByEmail = (existingUser?.users ?? []).find((u) => u.email?.toLowerCase() === email);
  if (userByEmail) {
    const { data: alreadyMember } = await ctx.admin
      .from('store_members')
      .select('id')
      .eq('store_id', storeId)
      .eq('user_id', userByEmail.id)
      .maybeSingle();
    if (alreadyMember) return fail('conflict', 'Brukeren er allerede medlem');
  }

  // De-dupe pending invites
  await ctx.admin
    .from('store_invitations')
    .delete()
    .eq('store_id', storeId)
    .eq('email', email)
    .is('accepted_at', null);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString();

  const { error } = await ctx.admin.from('store_invitations').insert({
    store_id: storeId,
    email,
    role: input.role,
    token,
    expires_at: expiresAt,
    invited_by: ctx.user.id,
  });
  if (error) {
    console.error('Invite insert failed', error);
    return fail('server_error', 'Kunne ikke opprette invitasjon');
  }

  // If the invitee already has an account, drop an in-app notification so they
  // discover the invite in their inbox (and on /profile/stores). No email yet.
  if (userByEmail) {
    const { data: store } = await ctx.admin.from('stores').select('name').eq('id', storeId).maybeSingle();
    await createNotification(ctx.admin, {
      userId: userByEmail.id,
      type: 'store_invite',
      title: `Invitasjon til ${store?.name ?? 'en butikk'}`,
      body: `Du er invitert som ${ROLE_LABEL_NB[input.role]}. Godta i «Mine butikker».`,
      url: '/profile/stores',
      actorId: ctx.user.id,
      referenceId: storeId,
    }, ctx.env);
  }

  const inviteUrl = `/invite/${token}`;
  // TODO(email): send invitation email here once email service is wired
  return ok({ token, inviteUrl });
}

export async function revokeInvitation(
  ctx: ServiceContext,
  invitationId: string,
): Promise<ServiceResult<{ ok: true }>> {
  const { data: inv } = await ctx.admin
    .from('store_invitations')
    .select('store_id')
    .eq('id', invitationId)
    .maybeSingle();
  if (!inv) return fail('not_found', 'Invitasjon ikke funnet');

  const myRole = await getMyRole(ctx, inv.store_id);
  if (!can.inviteMembers(myRole)) return fail('forbidden', 'Ikke tilgang');

  const { error } = await ctx.admin.from('store_invitations').delete().eq('id', invitationId);
  if (error) return fail('server_error', 'Kunne ikke fjerne invitasjon');
  return ok({ ok: true });
}

export async function listInvitations(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<Array<{ id: string; email: string; role: StoreRole; expires_at: string; created_at: string }>>> {
  const myRole = await getMyRole(ctx, storeId);
  if (!can.inviteMembers(myRole)) return fail('forbidden', 'Ikke tilgang');

  const { data, error } = await ctx.admin
    .from('store_invitations')
    .select('id, email, role, expires_at, created_at')
    .eq('store_id', storeId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });
  if (error) return fail('server_error', 'Kunne ikke hente invitasjoner');
  return ok(data ?? []);
}

export interface MyInvitation {
  token: string;
  role: StoreRole;
  expires_at: string;
  store_id: string;
  store_name: string;
  store_slug: string;
  store_logo_path: string | null;
}

/** Pending invitations addressed to the logged-in user's email, so they can be
 *  surfaced + accepted in-app (there's no invite email yet). Uses the admin
 *  client because store_invitations RLS is store-admin-scoped — the invitee
 *  isn't a member yet, so can't read the row under their own grants; we pin the
 *  read to their own email, which is the safe equivalent. */
export async function listMyInvitations(ctx: ServiceContext): Promise<ServiceResult<MyInvitation[]>> {
  const email = (ctx.user.email ?? '').toLowerCase();
  if (!email) return ok([]);
  const { data, error } = await ctx.admin
    .from('store_invitations')
    .select('token, role, expires_at, stores!inner(id, name, slug, logo_path)')
    .eq('email', email)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) { console.error('listMyInvitations failed', error); return fail('server_error', 'Kunne ikke hente invitasjoner'); }
  const out: MyInvitation[] = (data ?? []).map((r: any) => ({
    token: r.token, role: r.role, expires_at: r.expires_at,
    store_id: r.stores.id, store_name: r.stores.name, store_slug: r.stores.slug, store_logo_path: r.stores.logo_path,
  }));
  return ok(out);
}

/** The invitee declines an invitation addressed to their email. */
export async function declineMyInvitation(ctx: ServiceContext, token: string): Promise<ServiceResult<{ ok: true }>> {
  const email = (ctx.user.email ?? '').toLowerCase();
  const { data: inv } = await ctx.admin
    .from('store_invitations').select('id, email').eq('token', token).maybeSingle();
  if (!inv) return fail('not_found', 'Invitasjon ikke funnet');
  if (inv.email.toLowerCase() !== email) return fail('forbidden', 'Invitasjonen er for en annen e-postadresse');
  const { error } = await ctx.admin.from('store_invitations').delete().eq('id', inv.id);
  if (error) return fail('server_error', 'Kunne ikke avslå invitasjon');
  return ok({ ok: true });
}

export interface AcceptInvitationResult {
  storeId: string;
  storeSlug: string;
  redirect: string;
}

export async function acceptInvitation(
  ctx: ServiceContext,
  token: string,
): Promise<ServiceResult<AcceptInvitationResult>> {
  const { data: inv } = await ctx.admin
    .from('store_invitations')
    .select('id, store_id, email, role, expires_at, accepted_at')
    .eq('token', token)
    .maybeSingle();

  if (!inv) return fail('not_found', 'Invitasjon ikke funnet');
  if (inv.accepted_at) return fail('conflict', 'Invitasjonen er allerede brukt');
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    return fail('conflict', 'Invitasjonen er utløpt');
  }

  // The accepting user's email must match the invite email
  const userEmail = (ctx.user.email ?? '').toLowerCase();
  if (userEmail !== inv.email.toLowerCase()) {
    return fail('forbidden', 'Invitasjonen er for en annen e-postadresse');
  }

  // Already a member? Idempotent success.
  const { data: existing } = await ctx.admin
    .from('store_members')
    .select('id')
    .eq('store_id', inv.store_id)
    .eq('user_id', ctx.user.id)
    .maybeSingle();

  if (!existing) {
    const { error: insErr } = await ctx.admin.from('store_members').insert({
      store_id: inv.store_id,
      user_id: ctx.user.id,
      role: inv.role,
      invited_by: null,
    });
    if (insErr) {
      console.error('Member insert via invite failed', insErr);
      return fail('server_error', 'Kunne ikke legge til medlem');
    }
  }

  await ctx.admin
    .from('store_invitations')
    .update({ accepted_at: new Date().toISOString(), accepted_by: ctx.user.id })
    .eq('id', inv.id);

  const { data: store } = await ctx.admin.from('stores').select('slug').eq('id', inv.store_id).maybeSingle();
  const slug = store?.slug ?? '';
  return ok({
    storeId: inv.store_id,
    storeSlug: slug,
    redirect: slug ? `/market/store/${slug}/admin` : '/profile/stores',
  });
}
