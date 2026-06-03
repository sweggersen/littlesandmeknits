import type { ServiceResult, ServiceErrorCode } from './types';

const STATUS: Record<ServiceErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  bad_input: 400,
  conflict: 409,
  server_error: 500,
  service_unavailable: 503,
};

// Astro's typed RedirectFn restricts `status` to the 3xx literal union.
// Services don't care which redirect status the caller picks (303 is
// the default), so the parameter is widened to accept either Astro's
// strict type OR a plain (url, status?: number) callback.
type RedirectFn = (url: string, status?: number) => Response;
type AstroRedirectFn = (url: string, status?: 300 | 301 | 302 | 303 | 304 | 307 | 308) => Response;

export function toResponse(
  result: ServiceResult<any>,
  redirect?: RedirectFn | AstroRedirectFn,
): Response {
  if (!result.ok) {
    return new Response(result.message, { status: STATUS[result.code] });
  }
  if (result.data?.redirect && redirect) {
    return redirect(result.data.redirect, 303);
  }
  return Response.json(result.data ?? { ok: true });
}
