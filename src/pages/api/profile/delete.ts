import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { deleteAccount } from '../../../lib/services/profile';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Not signed in', { status: 401 });

  const form = await request.formData();
  const result = await deleteAccount(ctx, {
    confirm: String(form.get('confirm') ?? ''),
  });

  // Clear session cookies on successful delete so the now-anonymised
  // user isn't left signed in.
  if (result.ok) {
    cookies.delete('sb-access-token', { path: '/' });
    cookies.delete('sb-refresh-token', { path: '/' });
    cookies.delete('st_session', { path: '/' });
  }

  return toResponse(result, redirect);
};
