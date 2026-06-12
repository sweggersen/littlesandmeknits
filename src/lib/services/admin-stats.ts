import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

// Admin dashboard trends (june26.md §2.3). Spans all users, so it runs through
// the admin client behind an admin/moderator role check rather than RLS.

export interface DashboardTrends {
  gmv7: number;        // gross merchandise value (kr) of items sold in last 7d
  revenue7: number;    // platform fees (kr) on those sales
  sold7: number;       // count of items sold in last 7d
  gmv30: number;
  revenue30: number;
  sold30: number;
  signups7: number;
  signups30: number;
  activeListings: number;
  openDisputes: number;     // listings + commissions in 'disputed'
  openDeadLetters: number;  // unresolved money-path failures (§1.2)
  openSupport: number;      // open support_requests (§2.3)
  dailySold: number[];      // items sold per day, last 7 days, oldest -> newest (today)
}

const DAY = 86400_000;

export async function getDashboardTrends(ctx: ServiceContext): Promise<ServiceResult<DashboardTrends>> {
  // Privileged read across all users — gate on role explicitly (the admin
  // client bypasses RLS, so this check is the authorization).
  const { data: me } = await ctx.admin
    .from('profiles')
    .select('role')
    .eq('id', ctx.user.id)
    .maybeSingle();
  if (!me || (me.role !== 'admin' && me.role !== 'moderator')) {
    return fail('forbidden', 'Krever moderator- eller admin-tilgang');
  }

  const now = Date.now();
  const since7 = new Date(now - 7 * DAY).toISOString();
  const since30 = new Date(now - 30 * DAY).toISOString();

  // Pull 30 days of completed sales once; derive both windows + the sparkline.
  // GMV + revenue live on the order (delivered = released to the seller).
  const { data: sold } = await ctx.admin
    .from('orders')
    .select('item_price_nok, platform_fee_nok, delivered_at')
    .eq('status', 'delivered')
    .gte('delivered_at', since30);

  let gmv7 = 0, revenue7 = 0, sold7 = 0, gmv30 = 0, revenue30 = 0, sold30 = 0;
  const dailySold = new Array(7).fill(0) as number[];
  for (const r of sold ?? []) {
    const price = r.item_price_nok ?? 0;
    const fee = r.platform_fee_nok ?? 0;
    gmv30 += price; revenue30 += fee; sold30 += 1;
    const t = r.delivered_at ? new Date(r.delivered_at).getTime() : 0;
    if (t >= now - 7 * DAY) {
      gmv7 += price; revenue7 += fee; sold7 += 1;
      const idx = 6 - Math.floor((now - t) / DAY);
      if (idx >= 0 && idx < 7) dailySold[idx] += 1;
    }
  }

  const [signups7, signups30, activeListings, listingDisputes, commissionDisputes, deadLetters, openSupport] = await Promise.all([
    ctx.admin.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', since7),
    ctx.admin.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', since30),
    ctx.admin.from('listings').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    ctx.admin.from('listings').select('id', { count: 'exact', head: true }).eq('status', 'disputed'),
    ctx.admin.from('commission_requests').select('id', { count: 'exact', head: true }).eq('status', 'disputed'),
    ctx.admin.from('dead_letter_events').select('id', { count: 'exact', head: true }).is('resolved_at', null),
    ctx.admin.from('support_requests').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ]);

  return ok({
    gmv7, revenue7, sold7, gmv30, revenue30, sold30,
    signups7: signups7.count ?? 0,
    signups30: signups30.count ?? 0,
    activeListings: activeListings.count ?? 0,
    openDisputes: (listingDisputes.count ?? 0) + (commissionDisputes.count ?? 0),
    openDeadLetters: deadLetters.count ?? 0,
    openSupport: openSupport.count ?? 0,
    dailySold,
  });
}
