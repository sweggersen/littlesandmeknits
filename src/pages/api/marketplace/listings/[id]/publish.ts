import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../../lib/auth';
import { createServerSupabase } from '../../../../../lib/supabase';

// POST /api/marketplace/listings/:id/publish
// Move a draft listing to active. Gates on the seller having Stripe
// Connect charges enabled — otherwise we can't accept money on their
// behalf.

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');
  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });
  const { data: knitter } = await supabase
    .from('knitter_profiles')
    .select('stripe_charges_enabled, availability')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!knitter || !knitter.stripe_charges_enabled) {
    return redirect('/studio/marked/innstillinger?need_connect=1');
  }

  const { error } = await supabase
    .from('listings')
    .update({
      status: 'active',
      published_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('seller_id', user.id)
    .eq('status', 'draft');

  if (error) {
    console.error('Listing publish failed', error);
    return new Response('Could not publish listing', { status: 500 });
  }

  // First publish: open the seller's availability if still closed.
  if (knitter.availability === 'closed') {
    await supabase
      .from('knitter_profiles')
      .update({ availability: 'open' })
      .eq('user_id', user.id);
  }

  return redirect(`/studio/marked/listing/${id}`, 303);
};
