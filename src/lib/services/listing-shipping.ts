// Carrier label generation for listing sales (M3). Lets a seller mint a real
// Posten/Bring shipping label — auto-filled with the buyer's seeded address —
// instead of pasting a free-text tracking code. That gives a genuine
// consignment number (the fraud control the manual flow could only assume), and
// then delegates to the existing capture-at-ship path.
//
// Kept out of the mutation-gated listings-escrow.ts (money math) — this is
// shipping orchestration that *calls* the money path, not part of it. Helthjem
// can slot in later as a second carrier once its API is confirmed.

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { bringAuthFromEnv, bookShipment } from '../bring';
import { findOpenOrder } from './orders';
import { shipListing } from './listings-escrow';

export async function bookListingShipping(
  ctx: ServiceContext,
  input: { listingId: string; weightGrams?: number },
): Promise<ServiceResult<{ redirect: string; labelUrl: string | null }>> {
  if (!input.listingId) return fail('bad_input', 'Missing listing ID');

  // Gate behind a configured carrier — without Bring keys the seller keeps the
  // manual-tracking fallback (dev, or before the carrier account is live).
  const auth = bringAuthFromEnv(ctx.env);
  if (!auth) return fail('service_unavailable', 'Fraktetikett er ikke tilgjengelig ennå. Legg inn sporingsnummer manuelt.');

  const { data: listing } = await ctx.supabase
    .from('listings').select('id, seller_id, status').eq('id', input.listingId).maybeSingle();
  if (!listing || listing.seller_id !== ctx.user.id) return fail('not_found', 'Not found');
  if (listing.status !== 'reserved') return fail('conflict', 'Annonsen er ikke i «reservert»-fasen');

  const order = await findOpenOrder(ctx.admin, input.listingId);
  if (!order) return fail('not_found', 'Order not found');
  if (order.bring_shipment_number) return fail('conflict', 'Fraktetikett er allerede opprettet');
  if (!order.shipping_name || !order.shipping_address || !order.shipping_postal_code || !order.shipping_city) {
    return fail('bad_input', 'Mangler kjøpers leveringsadresse');
  }

  // The seller's return address (set at become-seller).
  const { data: seller } = await ctx.admin
    .from('seller_profiles').select('legal_name, address, postal_code, city').eq('id', ctx.user.id).maybeSingle();
  if (!seller?.address || !seller.postal_code || !seller.city) {
    return fail('bad_input', 'Legg inn returadressen din i selgerprofilen først.');
  }

  const result = await bookShipment(auth, {
    fromName: seller.legal_name ?? 'Selger',
    fromAddress: seller.address, fromPostal: seller.postal_code, fromCity: seller.city,
    toName: order.shipping_name, toAddress: order.shipping_address,
    toPostal: order.shipping_postal_code, toCity: order.shipping_city,
    weightGrams: input.weightGrams ?? 500,
  });
  if (!result) return fail('server_error', 'Kunne ikke opprette fraktetikett. Prøv igjen, eller legg inn sporing manuelt.');

  // Persist the label + shipment number on the order before capturing.
  await ctx.admin.from('orders').update({
    bring_shipment_number: result.shipmentNumber,
    label_free_code: result.labelFreeCode ?? null,
  }).eq('id', order.id);

  // Capture-at-ship with the real tracking number (reuses the money path,
  // which honours the payouts kill-switch).
  const shipped = await shipListing(ctx, { listingId: input.listingId, trackingCode: result.shipmentNumber });
  if (!shipped.ok) return shipped;

  return ok({ redirect: `/market/listing/${input.listingId}`, labelUrl: result.labelFreeCode ?? null });
}
