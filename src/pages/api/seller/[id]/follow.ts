import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';

// Toggle a follow on a seller. POST body action=follow|unfollow.
// JSON response for fetch callers, redirect back for form callers.
export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) {
    if (request.headers.get('Accept')?.includes('application/json')) {
      return Response.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
    }
    return redirect('/login');
  }

  const sellerId = params.id ?? '';
  if (!sellerId || sellerId === ctx.user.id) {
    return Response.json({ ok: false, error: 'bad_input' }, { status: 400 });
  }

  const form = await request.formData();
  const action = form.get('action')?.toString() ?? 'toggle';
  const next = form.get('next')?.toString() ?? request.headers.get('referer') ?? '/market';

  let following: boolean;

  if (action === 'follow' || action === 'toggle') {
    // Check current state for toggle.
    const { data: existing } = await ctx.supabase
      .from('seller_follows')
      .select('seller_id')
      .eq('follower_id', ctx.user.id)
      .eq('seller_id', sellerId)
      .maybeSingle();

    if (existing) {
      await ctx.supabase
        .from('seller_follows')
        .delete()
        .eq('follower_id', ctx.user.id)
        .eq('seller_id', sellerId);
      following = false;
    } else {
      const { error } = await ctx.supabase
        .from('seller_follows')
        .insert({ follower_id: ctx.user.id, seller_id: sellerId });
      if (error && error.code !== '23505') {
        return Response.json({ ok: false, error: error.message }, { status: 500 });
      }
      following = true;
    }
  } else if (action === 'unfollow') {
    await ctx.supabase
      .from('seller_follows')
      .delete()
      .eq('follower_id', ctx.user.id)
      .eq('seller_id', sellerId);
    following = false;
  } else {
    return Response.json({ ok: false, error: 'bad_action' }, { status: 400 });
  }

  if (request.headers.get('Accept')?.includes('application/json')) {
    return Response.json({ ok: true, following });
  }
  return Response.redirect(new URL(next, request.url), 303);
};
