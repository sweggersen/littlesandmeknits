// Display-gating reads about a seller that a buyer/visitor can't make under
// RLS. Kept in its own service module (not stripe-connect.ts) so the only thing
// that pulls in `env` here is the listing page + this file's own test — no
// unit-tested service graph reaches the static `cloudflare:workers` import.

import { createAdminSupabase } from '../supabase';
import { env } from '../env';
import type { ConnectStatus } from './stripe-connect';

/** A seller's Stripe Connect status, for gating the "buy with escrow" CTA on a
 *  listing. `seller_profiles` RLS is owner+staff only, so a buyer or anonymous
 *  visitor can't read it via their own client. This deliberately uses the
 *  service-role client — but exposes ONLY the coarse status enum, never KYC /
 *  payout PII — so no page module touches the admin client directly. */
export async function getSellerConnectStatus(sellerId: string): Promise<ConnectStatus | null> {
  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await admin
    .from('seller_profiles')
    .select('stripe_connect_status')
    .eq('id', sellerId)
    .maybeSingle();
  return ((data?.stripe_connect_status as ConnectStatus | null) ?? null);
}
