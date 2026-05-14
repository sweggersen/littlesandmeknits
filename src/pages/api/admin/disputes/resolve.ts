import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { resolveDispute } from '../../../../lib/services/disputes';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await resolveDispute(ctx, {
    itemType: form.get('item_type')?.toString() ?? '',
    itemId: form.get('item_id')?.toString() ?? '',
    decision: form.get('decision')?.toString() ?? '',
    notes: form.get('notes')?.toString(),
  });
  return toResponse(result, redirect);
};
