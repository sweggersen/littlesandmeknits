// Accept an invitation by token. Works for both JSON (mobile) and form (web).
import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { acceptInvitation } from '../../../../lib/services/store-invitations';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) {
    // Not logged in — bounce to login with next pointing back here
    const next = `/invite/${params.token}`;
    return redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  const result = await acceptInvitation(ctx, params.token ?? '');
  const wantsRedirect = !(request.headers.get('content-type') ?? '').includes('application/json');
  return toResponse(result, wantsRedirect ? redirect : undefined);
};
