import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { createPattern } from '../../../lib/services/external-patterns';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn?next=/profil/bibliotek/ny');

  const form = await request.formData();
  const file = form.get('file');
  const cover = form.get('cover');
  const result = await createPattern(ctx, {
    title: form.get('title')?.toString() ?? '',
    designer: form.get('designer')?.toString(),
    sourceUrl: form.get('source_url')?.toString(),
    notes: form.get('notes')?.toString(),
    file: file instanceof File ? file : null,
    cover: cover instanceof File ? cover : null,
  });
  return toResponse(result, redirect);
};
