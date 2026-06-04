import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { submitSupportRequest } from '../../../lib/services/support';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/login?next=/hjelp', 303);

  const form = await request.formData();
  const result = await submitSupportRequest(ctx, {
    category: form.get('category')?.toString(),
    subject: form.get('subject')?.toString(),
    body: form.get('body')?.toString(),
  });
  return toResponse(result, redirect);
};
