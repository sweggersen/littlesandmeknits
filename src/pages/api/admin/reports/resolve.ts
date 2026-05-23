import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { decideReport } from '../../../../lib/services/moderation-threads';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const applyToAllRaw = form.get('apply_to_all')?.toString();
  const result = await decideReport(ctx, {
    reportId: form.get('report_id')?.toString() ?? '',
    action: form.get('action')?.toString() ?? '',
    firstMessage: form.get('first_message')?.toString(),
    notes: form.get('notes')?.toString(),
    applyToAll: applyToAllRaw === undefined ? true : applyToAllRaw !== 'false',
  });
  return toResponse(result, redirect);
};
