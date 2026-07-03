// JSON API layer (pre-mobile foundation). The thin edge over the existing
// service layer for non-browser clients (mobile app, integrations): JSON in,
// JSON out, Bearer-token auth. The business logic is unchanged — routes still
// do parse → buildServiceContext → service → response — they just serialize as
// JSON instead of HTML redirects.
//
// Web keeps using the form/redirect routes under /api/marketplace/*; this
// namespace exists so a mobile client never has to parse a 303.

import type { AstroCookies } from 'astro';
import { buildServiceContext } from '../services/context';
import type { ServiceContext, ServiceResult, ServiceErrorCode } from '../services/types';

const STATUS: Record<ServiceErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  bad_input: 400,
  conflict: 409,
  server_error: 500,
  service_unavailable: 503,
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Build the service context for a JSON route, or return a 401 JSON response.
 *  Accepts a Bearer token (mobile) or the session cookie (web). */
export async function requireCtx(
  request: Request,
  cookies: AstroCookies,
): Promise<ServiceContext | Response> {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return json({ error: 'unauthorized' }, 401);
  return ctx;
}

/** Serialize a ServiceResult as JSON — the data on success (a `{ redirect }`
 *  becomes a plain field the client can act on), or `{ error, code }` on
 *  failure, with the matching HTTP status. */
export function jsonResult<T>(result: ServiceResult<T>): Response {
  if (!result.ok) return json({ error: result.message, code: result.code }, STATUS[result.code] ?? 400);
  return json((result.data as unknown) ?? { ok: true });
}
