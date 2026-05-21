// Member management: POST to invite, PATCH to change role,
// DELETE to remove. Accepts JSON or form-urlencoded.
import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { getStoreBySlugAdmin } from '../../../../lib/services/stores';
import { changeMemberRole, removeMember, updateMyPresentation } from '../../../../lib/services/store-members';
import { inviteMember } from '../../../../lib/services/store-invitations';
import { toResponse } from '../../../../lib/services/response';
import type { StoreRole } from '../../../../lib/types/stores';

async function parseBody(request: Request): Promise<{ body: Record<string, string>; isJson: boolean }> {
  const ct = request.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return { body: await request.json(), isJson: true };
  const form = await request.formData();
  return { body: Object.fromEntries([...form.entries()].map(([k, v]) => [k, v.toString()])), isJson: false };
}

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const store = await getStoreBySlugAdmin(ctx, params.slug ?? '');
  if (!store) return new Response('Not found', { status: 404 });

  const { body, isJson } = await parseBody(request);
  const action = body.action ?? body._action ?? 'invite';

  if (action === 'invite') {
    const result = await inviteMember(ctx, store.id, {
      email: body.email ?? '',
      role: (body.role as StoreRole) ?? 'contributor',
    });
    if (result.ok && !isJson) return redirect(`/market/store/${store.slug}/admin/members`);
    return toResponse(result);
  }
  if (action === 'change-role') {
    const result = await changeMemberRole(ctx, store.id, body.user_id ?? '', body.role as StoreRole);
    if (result.ok && !isJson) return redirect(`/market/store/${store.slug}/admin/members`);
    return toResponse(result);
  }
  if (action === 'remove') {
    const result = await removeMember(ctx, store.id, body.user_id ?? '');
    if (result.ok && !isJson) return redirect(`/market/store/${store.slug}/admin/members`);
    return toResponse(result);
  }
  if (action === 'update-presentation') {
    const result = await updateMyPresentation(ctx, store.id, {
      visible_on_storefront: body.visible_on_storefront === 'on' || body.visible_on_storefront === 'true',
      public_title: body.public_title,
    });
    if (result.ok && !isJson) return redirect(`/market/store/${store.slug}/admin/members`);
    return toResponse(result);
  }

  return new Response('Unknown action', { status: 400 });
};
