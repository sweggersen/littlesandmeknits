import type { TypedSupabaseClient } from '../supabase';

export interface ServiceContext {
  supabase: TypedSupabaseClient;
  admin: TypedSupabaseClient;
  user: { id: string; email?: string };
  env: Record<string, string>;
}

export type ServiceResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: ServiceErrorCode; message: string };

export type ServiceErrorCode =
  | 'unauthorized' | 'forbidden' | 'not_found' | 'bad_input'
  | 'conflict' | 'server_error' | 'service_unavailable';

export const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data });

export const fail = (code: ServiceErrorCode, message: string): ServiceResult<never> =>
  ({ ok: false, code, message });

// ── Authorization helpers ──────────────────────────────────────────────
// ONE greppable chokepoint for role checks. Services that gate on staff/admin
// role should call these instead of re-inlining the profiles lookup, so
// "who can do X" is answerable in one place. (Ownership checks — is this the
// resource's buyer/seller — stay inline since they compare against the fetched
// row.) Each returns a `forbidden` ServiceResult to short-circuit, or null to
// proceed:  const denied = await ensureStaff(ctx); if (denied) return denied;

/** Deny unless the actor's role is one of `roles`. */
export async function ensureRole(
  ctx: ServiceContext,
  roles: Array<'admin' | 'moderator'>,
): Promise<ServiceResult<never> | null> {
  const { data } = await ctx.admin
    .from('profiles').select('role').eq('id', ctx.user.id).maybeSingle();
  const role = data?.role as 'admin' | 'moderator' | null | undefined;
  return role && roles.includes(role) ? null : fail('forbidden', 'Insufficient privileges');
}

/** Deny unless the actor is an admin or moderator. */
export const ensureStaff = (ctx: ServiceContext) => ensureRole(ctx, ['admin', 'moderator']);

/** Deny unless the actor is an admin. */
export const ensureAdmin = (ctx: ServiceContext) => ensureRole(ctx, ['admin']);
