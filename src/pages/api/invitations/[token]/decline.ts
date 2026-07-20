// Decline an invitation addressed to the logged-in user's email.
import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { declineMyInvitation } from '../../../../lib/services/store-invitations';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const result = await declineMyInvitation(ctx, params.token ?? '');
  const wantsRedirect = !(request.headers.get('content-type') ?? '').includes('application/json');
  if (result.ok && wantsRedirect) return redirect('/profile/stores');
  return toResponse(result);
};
