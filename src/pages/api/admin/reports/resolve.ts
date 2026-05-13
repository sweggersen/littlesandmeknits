import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { resolveReport } from '../../../../lib/services/moderation';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const result = await resolveReport(ctx, {
    reportId: form.get('report_id')?.toString() ?? '',
    action: form.get('action')?.toString() ?? '',
    notes: form.get('notes')?.toString(),
  });
  return toResponse(result, redirect);
};
