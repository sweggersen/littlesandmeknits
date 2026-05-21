// Token-based email invitations to join a store. Mobile-friendly: the accept
// link works in any browser (HTML page) and the accept API takes JSON.

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { can, canAssignRole } from './store-permissions';
import { getMyRole } from './store-members';
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

  // Reject if already a member by email
  const { data: existingUser } = await ctx.admin.auth.admin.listUsers({ perPage: 1 });
  // (We don't have a direct "find by email" — listing all is fine for now,
  // but in production switch to admin.auth.getUserByEmail when available.)
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
