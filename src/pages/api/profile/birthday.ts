import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { setBirthday } from '../../../lib/services/profile';
import { toResponse } from '../../../lib/services/response';
import { safeInternalPath } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/login');

  const form = await request.formData();
  const result = await setBirthday(ctx, {
    day: form.get('day')?.toString(),
    month: form.get('month')?.toString(),
    year: form.get('year')?.toString(),
  });

  const next = form.get('next')?.toString();
  const safeNext = safeInternalPath(next, '/studio');

  if (request.headers.get('Accept')?.includes('application/json')) {
    return toResponse(result);
  }
  if (result.ok) {
    return new Response(null, { status: 303, headers: { Location: safeNext } });
  }
  return toResponse(result);
};
