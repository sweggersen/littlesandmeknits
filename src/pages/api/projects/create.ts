import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { createProject } from '../../../lib/services/projects';
import { toResponse } from '../../../lib/services/response';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return redirect('/logg-inn?next=/studio/prosjekter/ny');

  const form = await request.formData();
  const heroFile = form.get('hero_photo');
  const result = await createProject(ctx, {
    title: form.get('title')?.toString() ?? '',
    status: form.get('status')?.toString(),
    summary: form.get('summary')?.toString(),
    recipient: form.get('recipient')?.toString(),
    targetSize: form.get('target_size')?.toString(),
    yarn: form.get('yarn')?.toString(),
    needles: form.get('needles')?.toString(),
    patternSlug: form.get('pattern_slug')?.toString(),
    patternExternal: form.get('pattern_external')?.toString(),
    heroPhoto: heroFile instanceof File ? heroFile : null,
  });
  return toResponse(result, redirect);
};
