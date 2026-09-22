import type { ServiceResult, ServiceErrorCode } from './types';
import { log } from '../log';
import { captureException } from '../observability';

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

export async function toResponse(
  result: ServiceResult<any>,
  redirect?: RedirectFn | AstroRedirectFn,
  opts?: { saved?: boolean; errorRedirect?: string },
): Promise<Response> {
  if (!result.ok) {
    // A service_error/service_unavailable is a real 5xx — but it's RETURNED,
    // not thrown, so the middleware's captureException never sees it. Surface it
    // to logs + Sentry here (once, at the single response chokepoint) so prod
    // 500s aren't invisible. 4xx are expected client errors and stay quiet.
    if (result.code === 'server_error' || result.code === 'service_unavailable') {
      log.error('service.error_response', { code: result.code, message: result.message });
      await captureException(new Error(result.message), { service: 'toResponse', extra: { code: result.code } });
    }
    // Form routes pass errorRedirect so a failure returns to the form with the
    // message in ?error= (rendered by the toast controller) instead of a bare
    // English error page. JSON/API callers omit it and still get the plain
    // status + message.
    if (opts?.errorRedirect && redirect) {
      const sep = opts.errorRedirect.includes('?') ? '&' : '?';
      return redirect(`${opts.errorRedirect}${sep}error=${encodeURIComponent(result.message)}`, 303);
    }
    return new Response(result.message, { status: STATUS[result.code] });
  }
  if (result.data?.redirect && redirect) {
    // `saved` opts a form route into a "Lagret" confirmation: append saved=1 so
    // the destination page's toast controller can show + then strip it.
    let url = result.data.redirect as string;
    if (opts?.saved) url += (url.includes('?') ? '&' : '?') + 'saved=1';
    return redirect(url, 303);
  }
  return Response.json(result.data ?? { ok: true });
}
