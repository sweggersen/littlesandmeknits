import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { toggleSellerFollow } from '../../../../lib/services/seller-follows';
import { toResponse } from '../../../../lib/services/response';
import { safeInternalPath } from '../../../../lib/auth';

// Toggle a follow on a seller. Non-JS forms POST `next` (redirect target) and get
// a redirect back; fetch callers set Accept: application/json and get JSON.
export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const wantsJson = request.headers.get('Accept')?.includes('application/json');
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) {
    return wantsJson
      ? Response.json({ ok: false, error: 'not_authenticated' }, { status: 401 })
      : redirect('/login');
  }

  const form = await request.formData();
  // Validate the redirect target — never trust the raw form value or referer
  // (open-redirect vector). Only same-origin absolute paths pass.
  const next = safeInternalPath(form.get('next')?.toString(), '/market');

  const result = await toggleSellerFollow(ctx, params.id ?? '');

  if (wantsJson) return toResponse(result);
  if (!result.ok) {
    return redirect(`${next}${next.includes('?') ? '&' : '?'}error=${encodeURIComponent(result.message)}`, 303);
  }
  return redirect(next, 303);
};
