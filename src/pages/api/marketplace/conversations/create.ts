import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { createConversation } from '../../../../lib/services/conversations';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const listingId = form.get('listing_id')?.toString() ?? '';

  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect(`/logg-inn?next=${encodeURIComponent(`/marked/listing/${listingId}`)}`);

  const result = await createConversation(ctx, {
    listingId,
    message: form.get('message')?.toString() ?? '',
  });
  return toResponse(result, redirect);
};
