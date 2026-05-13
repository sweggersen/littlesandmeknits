import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { reviewItem } from '../../../../lib/services/moderation';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const result = await reviewItem(ctx, {
    queueId: form.get('queue_id')?.toString() ?? '',
    decision: form.get('decision')?.toString() ?? '',
    rejectionReason: form.get('rejection_reason')?.toString(),
    internalNotes: form.get('internal_notes')?.toString(),
  });
  return toResponse(result, redirect);
};
