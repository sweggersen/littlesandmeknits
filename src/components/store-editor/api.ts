// Thin client-side wrappers over the store-page + assets API routes. Every call
// hits a route that re-sanitises and re-authorises server-side; this module
// only shapes the request. Errors surface as thrown Errors carrying the server
// message so the UI can toast them.

import type { StoreTheme } from '../../lib/store-theme';
import type { StoreBlock } from '../../lib/store-blocks';
import type { EditorAsset } from './types';

function builderUrl(slug: string): string {
  return `/api/stores/${encodeURIComponent(slug)}/page-builder`;
}

async function postAction(slug: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(builderUrl(slug), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return res.json();
}

/** Save the working draft (theme + blocks) to the *_draft columns. */
export function saveDraft(slug: string, theme: StoreTheme, blocks: StoreBlock[]): Promise<any> {
  return postAction(slug, { action: 'save-draft', theme, page_config: { blocks } });
}

/** Copy the saved draft to the live storefront. */
export function publishDraft(slug: string): Promise<any> {
  return postAction(slug, { action: 'publish-draft' });
}

/** Apply a starter preset to the draft. */
export function applyPresetDraft(slug: string, presetId: string): Promise<any> {
  return postAction(slug, { action: 'apply-preset-draft', presetId });
}

/** Clear the draft back to platform default. */
export function resetDraft(slug: string): Promise<any> {
  return postAction(slug, { action: 'reset-draft' });
}

export async function uploadAsset(
  slug: string,
  kind: string,
  file: File,
  alt?: string,
): Promise<{ asset: EditorAsset }> {
  const fd = new FormData();
  fd.set('kind', kind);
  fd.set('file', file);
  if (alt) fd.set('alt', alt);
  const res = await fetch(`/api/stores/${encodeURIComponent(slug)}/assets`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return res.json();
}
