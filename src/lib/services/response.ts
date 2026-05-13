import type { ServiceResult, ServiceErrorCode } from './types';

const STATUS: Record<ServiceErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  bad_input: 400,
  conflict: 409,
  server_error: 500,
};

export function toResponse(
  result: ServiceResult<any>,
  redirect?: (url: string, status?: number) => Response,
): Response {
  if (!result.ok) {
    return new Response(result.message, { status: STATUS[result.code] });
  }
  if (result.data?.redirect && redirect) {
    return redirect(result.data.redirect, 303);
  }
  return Response.json(result.data ?? { ok: true });
}
