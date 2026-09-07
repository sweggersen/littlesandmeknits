// POST /api/stores/:slug/page-builder  (JSON: { action, ... })
// Storefront theming + page-builder writes. All member-gated + sanitised in the
// store-page service; this route only parses input and dispatches.
import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../../lib/services/context';
import { getStoreBySlugAdmin } from '../../../../lib/services/stores';
import {
  applyPreset,
  saveStoreTheme,
  saveStorePage,
  resetStorePage,
} from '../../../../lib/services/store-page';
import { toResponse } from '../../../../lib/services/response';

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  const store = await getStoreBySlugAdmin(ctx, params.slug ?? '');
  if (!store) return new Response('Not found', { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== 'string') return new Response('Bad request', { status: 400 });

  switch (body.action) {
    case 'apply-preset':
      return toResponse(await applyPreset(ctx, store.id, String(body.presetId ?? '')));
    case 'save-theme':
      return toResponse(await saveStoreTheme(ctx, store.id, body.theme));
    case 'save-page':
      return toResponse(await saveStorePage(ctx, store.id, body.page_config));
    case 'reset':
      return toResponse(await resetStorePage(ctx, store.id));
    default:
      return new Response('Unknown action', { status: 400 });
  }
};
