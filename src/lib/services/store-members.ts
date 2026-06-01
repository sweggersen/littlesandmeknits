// Membership management: list, change role, remove, get current user's role.

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { can, canAssignRole } from './store-permissions';
import type { StoreMemberWithProfile, StoreRole } from '../types/stores';

/** Get the current user's role for a given store, or null if not a member. */
export async function getMyRole(
  ctx: ServiceContext,
  storeId: string,
): Promise<StoreRole | null> {
  const { data } = await ctx.admin
    .from('store_members')
    .select('role')
    .eq('store_id', storeId)
    .eq('user_id', ctx.user.id)
    .maybeSingle();
  return (data?.role as StoreRole | undefined) ?? null;
}

export async function getMyRoleBySlug(
  ctx: ServiceContext,
  slug: string,
): Promise<{ role: StoreRole | null; storeId: string | null }> {
  const { data: store } = await ctx.admin
    .from('stores')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (!store) return { role: null, storeId: null };
  const role = await getMyRole(ctx, store.id);
  return { role, storeId: store.id };
}

export async function listMembers(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<StoreMemberWithProfile[]>> {
  const role = await getMyRole(ctx, storeId);
  if (!role) return fail('forbidden', 'Ikke medlem av butikken');

  const { data, error } = await ctx.admin
    .from('store_members')
    .select(`
      id, store_id, user_id, role, visible_on_storefront, public_title,
      joined_at, invited_by,
      profiles:profiles!store_members_user_id_fkey(display_name, avatar_path),
      auth_user:profiles!store_members_user_id_fkey(display_name)
    `)
    .eq('store_id', storeId)
    .order('joined_at');

  if (error) return fail('server_error', 'Kunne ikke hente medlemmer');

  const members: StoreMemberWithProfile[] = (data ?? []).map((m: any) => ({
    id: m.id,
    store_id: m.store_id,
    user_id: m.user_id,
    role: m.role,
    visible_on_storefront: m.visible_on_storefront,
    public_title: m.public_title,
    joined_at: m.joined_at,
    invited_by: m.invited_by,
    display_name: m.profiles?.display_name ?? null,
    email: null, // fill via auth admin if needed
    avatar_path: m.profiles?.avatar_path ?? null,
  }));

  return ok(members);
}

export async function changeMemberRole(
  ctx: ServiceContext,
  storeId: string,
  targetUserId: string,
  newRole: StoreRole,
): Promise<ServiceResult<{ ok: true }>> {
  const myRole = await getMyRole(ctx, storeId);
  if (!can.changeMemberRole(myRole)) return fail('forbidden', 'Ikke tilgang');
  if (!canAssignRole(myRole, newRole)) return fail('forbidden', 'Kan ikke tildele denne rollen');

  // Can't change your own role away from owner (must transfer first)
  if (targetUserId === ctx.user.id && myRole === 'owner' && newRole !== 'owner') {
    return fail('conflict', 'Du må overdra eierskap først');
  }

  // Owners are special: if demoting an owner, need to make sure at least one remains
  const { data: target } = await ctx.admin
    .from('store_members')
    .select('role')
    .eq('store_id', storeId)
    .eq('user_id', targetUserId)
    .maybeSingle();
  if (!target) return fail('not_found', 'Medlem ikke funnet');

  if (target.role === 'owner' && newRole !== 'owner') {
    const { count } = await ctx.admin
      .from('store_members')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('role', 'owner');
    if ((count ?? 0) <= 1) return fail('conflict', 'Må ha minst én eier');
  }

  const { error } = await ctx.admin
    .from('store_members')
    .update({ role: newRole })
    .eq('store_id', storeId)
    .eq('user_id', targetUserId);
  if (error) return fail('server_error', 'Kunne ikke endre rolle');
  return ok({ ok: true });
}

export async function removeMember(
  ctx: ServiceContext,
  storeId: string,
  targetUserId: string,
): Promise<ServiceResult<{ ok: true }>> {
  const myRole = await getMyRole(ctx, storeId);
  const isSelf = targetUserId === ctx.user.id;

  if (!isSelf && !can.removeMembers(myRole)) return fail('forbidden', 'Ikke tilgang');

  // Owner can't remove themselves without transferring
  if (isSelf && myRole === 'owner') {
    const { count } = await ctx.admin
      .from('store_members')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('role', 'owner');
    if ((count ?? 0) <= 1) return fail('conflict', 'Overdra eierskap før du forlater');
  }

  // Can't remove last owner via admin route either
  const { data: target } = await ctx.admin
    .from('store_members')
    .select('role')
    .eq('store_id', storeId)
    .eq('user_id', targetUserId)
    .maybeSingle();
  if (!target) return fail('not_found', 'Medlem ikke funnet');
  if (target.role === 'owner' && !isSelf) {
    const { count } = await ctx.admin
      .from('store_members')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('role', 'owner');
    if ((count ?? 0) <= 1) return fail('conflict', 'Kan ikke fjerne siste eier');
  }

  const { error } = await ctx.admin
    .from('store_members')
    .delete()
    .eq('store_id', storeId)
    .eq('user_id', targetUserId);
  if (error) return fail('server_error', 'Kunne ikke fjerne medlem');
  return ok({ ok: true });
}

export interface UpdateMemberPresentationInput {
  visible_on_storefront?: boolean;
  public_title?: string | null;
}

/** Lets a member edit their own storefront presentation (visibility, title). */
export async function updateMyPresentation(
  ctx: ServiceContext,
  storeId: string,
  patch: UpdateMemberPresentationInput,
): Promise<ServiceResult<{ ok: true }>> {
  const role = await getMyRole(ctx, storeId);
  if (!role) return fail('forbidden', 'Ikke medlem');

  const update: Record<string, unknown> = {};
  if (patch.visible_on_storefront !== undefined) update.visible_on_storefront = patch.visible_on_storefront;
  if (patch.public_title !== undefined) update.public_title = patch.public_title?.trim() || null;
  if (Object.keys(update).length === 0) return ok({ ok: true });

  const { error } = await ctx.admin
    .from('store_members')
    .update(update as never)
    .eq('store_id', storeId)
    .eq('user_id', ctx.user.id);
  if (error) return fail('server_error', 'Kunne ikke oppdatere');
  return ok({ ok: true });
}
