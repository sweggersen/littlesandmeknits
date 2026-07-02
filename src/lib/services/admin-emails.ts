// Auth email lookup for admin screens (disputes, moderation detail). Emails
// live in auth.users, reachable only via the service-role auth API — no RLS
// policy can grant this, so unlike the other admin-page reads it stays on
// ctx.admin, wrapped here behind an explicit staff check (services authorize;
// pages display).

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

/** Emails for the given user ids, keyed by id. Missing/deleted users are
 *  simply absent from the map. Staff only. */
export async function getAuthEmails(
  ctx: ServiceContext,
  userIds: Array<string | null | undefined>,
): Promise<ServiceResult<Map<string, string>>> {
  const { data: me } = await ctx.admin
    .from('profiles')
    .select('role')
    .eq('id', ctx.user.id)
    .maybeSingle();
  if (!me || (me.role !== 'admin' && me.role !== 'moderator')) {
    return fail('forbidden', 'Krever moderator- eller admin-tilgang');
  }

  const ids = [...new Set(userIds.filter((v): v is string => !!v))];
  const out = new Map<string, string>();
  for (const id of ids) {
    const { data } = await ctx.admin.auth.admin.getUserById(id);
    const email = data?.user?.email;
    if (email) out.set(id, email);
  }
  return ok(out);
}
