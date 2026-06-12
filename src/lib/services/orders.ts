// Orders, Phase B (see docs/ORDERS_MIGRATION.md).
//
// The `orders` table is the eventual source of truth for the purchase
// lifecycle. Phase B writes it as a SHADOW alongside the existing listing
// columns: every service that transitions a purchase writes the order here too,
// so correct order data (incl. relist history the old single-row model
// destroyed) accumulates while readers stay on the dual-written listing columns.
// Phase C flips readers to orders and drops the listing columns.

import type { TypedSupabaseClient } from '../supabase';
import type { Database } from '../database.types';

export type OrderStatus = Database['public']['Enums']['order_status'];
export type OrderRow = Database['public']['Tables']['orders']['Row'];
export type OrderInsert = Database['public']['Tables']['orders']['Insert'];
export type OrderUpdate = Database['public']['Tables']['orders']['Update'];

// Matches the orders_one_open_per_listing partial unique index.
const OPEN: OrderStatus[] = ['reserved', 'shipped', 'disputed'];

/** The open order (reserved | shipped | disputed) for a listing, if any. */
export async function findOpenOrder(
  admin: TypedSupabaseClient,
  listingId: string,
): Promise<OrderRow | null> {
  const { data } = await admin
    .from('orders')
    .select('*')
    .eq('listing_id', listingId)
    .in('status', OPEN)
    .maybeSingle();
  return data ?? null;
}

/** Create the reserved order for a completed purchase. Idempotent: the partial
 *  unique index rejects a second open order for the listing, so a duplicate
 *  webhook delivery (or a relist race) is a safe no-op rather than an error —
 *  the listing-side status guard already gated the duplicate transition. */
export async function createReservedOrder(
  admin: TypedSupabaseClient,
  order: OrderInsert,
): Promise<void> {
  const { error } = await admin.from('orders').insert(order);
  // 23505 = unique_violation on orders_one_open_per_listing.
  if (error && error.code !== '23505') throw error;
}

/** Patch the open order for a listing (shadow write next to the listing
 *  mirror). No-op when there is no open order — e.g. legacy purchases that
 *  predate Phase A's backfill, or manual "Kan møtes" sales with no order. */
export async function updateOpenOrder(
  admin: TypedSupabaseClient,
  listingId: string,
  patch: OrderUpdate,
): Promise<void> {
  await admin
    .from('orders')
    .update(patch)
    .eq('listing_id', listingId)
    .in('status', OPEN);
}

/** Patch the order behind a PaymentIntent — used by Stripe events (chargeback,
 *  charge.refunded) that can land AFTER the order is delivered/closed, where
 *  the open-status filter wouldn't match. A PI id maps to exactly one order. */
export async function updateOrderByPaymentIntent(
  admin: TypedSupabaseClient,
  paymentIntentId: string,
  patch: OrderUpdate,
): Promise<void> {
  await admin
    .from('orders')
    .update(patch)
    .eq('stripe_payment_intent_id', paymentIntentId);
}
