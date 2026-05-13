import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { bookShipping } from '../../../../lib/services/commissions';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn');

  const form = await request.formData();
  const result = await bookShipping(ctx, {
    requestId: form.get('request_id')?.toString() ?? '',
    fromName: form.get('from_name')?.toString()?.trim().slice(0, 200) ?? '',
    fromAddress: form.get('from_address')?.toString()?.trim().slice(0, 200) ?? '',
    fromPostal: form.get('from_postal')?.toString()?.trim() ?? '',
    fromCity: form.get('from_city')?.toString()?.trim().slice(0, 200) ?? '',
    toName: form.get('to_name')?.toString()?.trim().slice(0, 200) ?? '',
    toAddress: form.get('to_address')?.toString()?.trim().slice(0, 200) ?? '',
    toPostal: form.get('to_postal')?.toString()?.trim() ?? '',
    toCity: form.get('to_city')?.toString()?.trim().slice(0, 200) ?? '',
  });
  return toResponse(result, redirect);
};
