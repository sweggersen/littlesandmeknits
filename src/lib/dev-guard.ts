// Guard for /api/dev/* endpoints (security audit F2).
//
// The old per-endpoint guard was:
//   if (import.meta.env.PROD) return 403;
//   if (host not in {localhost, 127.0.0.1} && !host.endsWith('.workers.dev')) return 403;
//
// The `.workers.dev` blanket allowance is the weakness: any non-production
// build (PROD === false) deployed to *any* workers.dev preview host would
// expose these powerful endpoints (session minting, service-role DB ops).
//
// This replaces it with: blocked on prod builds, always allowed on localhost,
// and on any other host ONLY when the deploy explicitly opts in via the
// runtime secret DEV_TOOLS='enabled'. So a stray preview build is closed by
// default; a trusted preview is an explicit, revocable env flip.

import { env } from './env';

/** Pure decision function — unit-testable without env/import.meta. */
export function isDevToolsAllowed(p: {
  isProd: boolean;
  host: string;
  devToolsFlag: string | undefined;
}): boolean {
  if (p.isProd) return false;
  if (p.host === 'localhost' || p.host === '127.0.0.1' || p.host === '[::1]') return true;
  return p.devToolsFlag === 'enabled';
}

/** Returns a 403 Response if dev tools must not run for this request, else null.
 *  Usage in an endpoint:  const blocked = devToolsBlocked(request); if (blocked) return blocked; */
export function devToolsBlocked(request: Request): Response | null {
  const host = new URL(request.url).hostname;
  const allowed = isDevToolsAllowed({
    isProd: import.meta.env.PROD,
    host,
    devToolsFlag: (env as unknown as Record<string, string | undefined>).DEV_TOOLS,
  });
  return allowed ? null : new Response('Not available', { status: 403 });
}
