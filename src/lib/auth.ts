import type { APIContext, AstroCookies } from 'astro';
import type { User } from '@supabase/supabase-js';
import { createServerSupabase, createAdminSupabase } from './supabase';

/** Raw user lookup. Prefer `Astro.locals.user` set by middleware for
 *  ordinary pages — this helper is for code paths the middleware
 *  doesn't run (API routes, dev tools, places where you need a fresh
 *  user without the locals plumbing). */
export async function getCurrentUser(opts: {
  request: Request;
  cookies: AstroCookies;
}): Promise<User | null> {
  try {
    const supabase = createServerSupabase(opts);
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
