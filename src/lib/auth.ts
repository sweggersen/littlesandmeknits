import type { APIContext, AstroCookies } from 'astro';
import type { User } from '@supabase/supabase-js';
import { createServerSupabase, createAdminSupabase } from './supabase';

/** True when the Cookie header carries a Supabase auth session cookie
 *  (`sb-<ref>-auth-token`, possibly chunked as `.0`/`.1`). Lets the
 *  middleware skip the getUser() NETWORK round-trip for anonymous
 *  visitors — no cookie can never resolve to a user. */
export function hasSupabaseAuthCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return /(?:^|;\s*)sb-[^=;]*-auth-token(?:\.\d+)?=/.test(cookieHeader);
}

/** The Supabase access token from an `Authorization: Bearer <jwt>` header, or
 *  null. This is how non-browser clients (mobile app, API consumers)
 *  authenticate — no cookies. */
export function extractBearerToken(request: Request): string | null {
  const h = request.headers.get('Authorization') ?? request.headers.get('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  const token = h.slice(7).trim();
  return token || null;
}

/** The synthetic address minted for Vipps logins (src/lib/vipps-session.ts) —
 *  it can't receive mail, so it must never be used as a send target. */
const VIPPS_SYNTH_DOMAIN = '@vipps.users.littlesandmeknits.com';

/** The user's REAL, deliverable email, or null. Vipps logins carry a synthetic
 *  auth email but preserve the real one in user_metadata.vipps_email — prefer
 *  that; otherwise the auth email if it isn't the synthetic placeholder. Use
 *  this everywhere we SEND mail or prefill Stripe, never the raw auth email. */
export function resolveUserEmail(
  user: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null | undefined,
): string | null {
  if (!user) return null;
  const vippsEmail = user.user_metadata?.vipps_email;
  if (typeof vippsEmail === 'string' && vippsEmail.includes('@') && !vippsEmail.endsWith(VIPPS_SYNTH_DOMAIN)) {
    return vippsEmail;
  }
  if (user.email && !user.email.endsWith(VIPPS_SYNTH_DOMAIN)) return user.email;
  return null;
}

/** Raw user lookup. Prefer `Astro.locals.user` set by middleware for
 *  ordinary pages — this helper is for code paths the middleware
 *  doesn't run (API routes, dev tools, places where you need a fresh
 *  user without the locals plumbing).
 *
 *  Dual-mode: a `Bearer` token (mobile/API) is verified directly; otherwise
 *  the SSR session cookie (web) is used. */
export async function getCurrentUser(opts: {
  request: Request;
  cookies: AstroCookies;
}): Promise<User | null> {
  const token = extractBearerToken(opts.request);
  try {
    const supabase = createServerSupabase(opts);
    const {
      data: { user },
    } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}

export type Role = 'admin' | 'moderator' | 'ambassador' | null;

/** Looks up the user's role from `profiles.role`. Uses the admin client
 *  on purpose — moderator/admin gating needs to read the role even when
 *  RLS on profiles would otherwise restrict the row.  */
export async function getRole(userId: string, serviceRoleKey: string): Promise<Role> {
  const admin = createAdminSupabase(serviceRoleKey);
  const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle();
  return ((data as any)?.role as Role) ?? null;
}

/** Page-level guard: returns the user or short-circuits with a redirect
 *  response. Use in `.astro` frontmatter:
 *
 *    const guard = await requireUser(Astro);
 *    if (guard instanceof Response) return guard;
 *    const user = guard;
 */
export async function requireUser(
  ctx: APIContext | { request: Request; cookies: AstroCookies; locals?: App.Locals; url: URL; redirect?: (url: string, status?: number) => Response },
): Promise<User | Response> {
  const fromLocals = (ctx as any).locals?.user as User | null | undefined;
  const user = fromLocals ?? (await getCurrentUser({ request: ctx.request, cookies: ctx.cookies }));
  if (user) return user;
  const next = ctx.url.pathname + (ctx.url.search ?? '');
  const target = `/login?next=${encodeURIComponent(next)}`;
  if ((ctx as any).redirect) return (ctx as any).redirect(target, 302);
  return new Response(null, { status: 302, headers: { Location: target } });
}

/** Like `requireUser` but also checks the user has one of the given
 *  roles. Returns a 403 Response if signed in but underprivileged,
 *  and a redirect to /login if not signed in at all. */
export async function requireRole(
  ctx: APIContext | { request: Request; cookies: AstroCookies; locals?: App.Locals; url: URL; redirect?: (url: string, status?: number) => Response },
  roles: NonNullable<Role>[],
  serviceRoleKey: string,
): Promise<{ user: User; role: Role } | Response> {
  const userOrResponse = await requireUser(ctx);
  if (userOrResponse instanceof Response) return userOrResponse;
  const role = await getRole(userOrResponse.id, serviceRoleKey);
  if (!role || !roles.includes(role)) {
    return new Response('Forbidden', { status: 403 });
  }
  return { user: userOrResponse, role };
}
