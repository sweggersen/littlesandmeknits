import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCurrentUser } from '../../../../../lib/auth';
import { createAdminSupabase, createServerSupabase } from '../../../../../lib/supabase';

// POST /api/marketplace/orders/:id/ship
// Seller marks the order shipped and (optionally) pastes a tracking
// code. Moves status paid → shipped.

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return new Response('Server not configured', { status: 503 });

  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  const form = await request.formData();
  const carrier = form.get('shipping_carrier')?.toString().trim() || null;
  const tracking = form.get('shipping_tracking')?.toString().trim() || null;

  // Verify the seller owns this order via RLS-respecting client.
  const supabase = createServerSupabase({ request, cookies });
  const { data: order } = await supabase
    .from('marketplace_orders')
    .select('id, seller_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!order || order.seller_id !== user.id) {
    return new Response('Not found', { status: 404 });
  }
  if (order.status !== 'paid') {
    return new Response('Order not in paid state', { status: 409 });
  }

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await admin
    .from('marketplace_orders')
    .update({
      status: 'shipped',
      shipped_at: new Date().toISOString(),
      shipping_carrier: carrier,
      shipping_tracking: tracking,
    })
    .eq('id', id)
    .eq('status', 'paid');
  if (error) {
    console.error('Order ship update failed', error);
    return new Response('Could not update', { status: 500 });
  }
  return redirect(`/studio/marked/ordrer/${id}`, 303);
};
