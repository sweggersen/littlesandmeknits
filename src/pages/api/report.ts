import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../lib/services/context';
import { submitReport } from '../../lib/services/reports';
import { toResponse } from '../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const result = await submitReport(ctx, {
    targetType: form.get('target_type')?.toString() ?? '',
    targetId: form.get('target_id')?.toString() ?? '',
    reason: form.get('reason')?.toString() ?? '',
    description: form.get('description')?.toString(),
  });
  return toResponse(result);
};
