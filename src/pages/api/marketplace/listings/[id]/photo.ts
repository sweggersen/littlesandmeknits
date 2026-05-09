import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../../../lib/auth';
import { createServerSupabase } from '../../../../../lib/supabase';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../../../../../lib/storage';

const MAX_PHOTOS = 6;

async function syncHero(supabase: any, listingId: string) {
  const { data: first } = await supabase
    .from('listing_photos')
    .select('path')
    .eq('listing_id', listingId)
    .order('position')
    .limit(1)
    .maybeSingle();
  await supabase
    .from('listings')
    .update({ hero_photo_path: first?.path ?? null })
    .eq('id', listingId);
}

function wantsJson(request: Request) {
  return request.headers.get('Accept')?.includes('application/json');
}

function ok(request: Request, redirectUrl: string, body: Record<string, unknown> = {}) {
  if (wantsJson(request)) return Response.json({ ok: true, ...body });
  return Response.redirect(new URL(redirectUrl, request.url), 303);
}

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return redirect('/logg-inn');

  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  const supabase = createServerSupabase({ request, cookies });

  const { data: listing } = await supabase
    .from('listings')
    .select('id, seller_id')
    .eq('id', id)
    .maybeSingle();
  if (!listing || listing.seller_id !== user.id) {
    return new Response('Not found', { status: 404 });
  }

  const form = await request.formData();
  const action = form.get('action')?.toString();

  if (action === 'delete') {
    const photoId = form.get('photo_id')?.toString();
    if (!photoId) return new Response('Missing photo_id', { status: 400 });

    const { data: photo } = await supabase
      .from('listing_photos')
      .select('path')
      .eq('id', photoId)
      .eq('listing_id', id)
      .maybeSingle();

    if (photo) {
      await supabase.storage.from('projects').remove([photo.path]);
      await supabase.from('listing_photos').delete().eq('id', photoId);
      await syncHero(supabase, id);
    }

    return ok(request, `/marked/listing/${id}`);
  }

  if (action === 'caption') {
    const photoId = form.get('photo_id')?.toString();
    const caption = form.get('caption')?.toString() ?? '';
    if (!photoId) return new Response('Missing photo_id', { status: 400 });

    await supabase
      .from('listing_photos')
      .update({ caption: caption || null })
      .eq('id', photoId)
      .eq('listing_id', id);

    return ok(request, `/marked/listing/${id}`);
  }

  if (action === 'reorder') {
    const orderJson = form.get('order')?.toString();
    if (!orderJson) return new Response('Missing order', { status: 400 });

    try {
      const ids: string[] = JSON.parse(orderJson);
      for (let i = 0; i < ids.length; i++) {
        await supabase
          .from('listing_photos')
          .update({ position: i })
          .eq('id', ids[i])
          .eq('listing_id', id);
      }
      await syncHero(supabase, id);
    } catch {
      return new Response('Invalid order', { status: 400 });
    }

    return ok(request, `/marked/listing/${id}`);
  }

  // Default: upload new photos
  const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return redirect(`/marked/listing/${id}`, 303);

  const { count } = await supabase
    .from('listing_photos')
    .select('*', { count: 'exact', head: true })
    .eq('listing_id', id);

  const slotsLeft = MAX_PHOTOS - (count ?? 0);
  if (slotsLeft <= 0) {
    return new Response(`Maks ${MAX_PHOTOS} bilder per annonse`, { status: 400 });
  }

  const toUpload = files.slice(0, slotsLeft);

  for (const file of toUpload) {
    if (file.size > MAX_PHOTO_BYTES) return new Response('Bildet er for stort (maks 10 MB)', { status: 400 });
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) return new Response('Filtypen støttes ikke', { status: 400 });
  }

  let position = count ?? 0;
  for (const file of toUpload) {
    const ext = extFromMime(file.type);
    const path = `${user.id}/listings/${id}/photo-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('projects')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      console.error('Photo upload failed', upErr);
      return new Response('Opplasting feilet', { status: 500 });
    }

    await supabase.from('listing_photos').insert({
      listing_id: id,
      path,
      position,
    });
    position++;
  }

  await syncHero(supabase, id);
  return redirect(`/marked/listing/${id}`, 303);
};
