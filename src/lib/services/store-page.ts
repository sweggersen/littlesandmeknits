// Store page-builder + theming + asset service.
//
// Every write here is member-gated (manager+ via can.editBranding) and
// sanitises its input before persisting. Theme/page_config are stored as jsonb
// on `stores`; assets get a `store_assets` row plus a file under the uploader's
// own storage folder (`<uid>/…`, matching the 0003 storage RLS pin).

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { getMyRole } from './store-members';
import { can } from './store-permissions';
import { sanitizeStoreTheme, type StoreTheme } from '../store-theme';
import { sanitizePageConfig, type StorePageConfig, type StorefrontAsset } from '../store-blocks';
import { getPreset, STORE_PRESET_IDS } from '../store-presets';
import { ALLOWED_IMAGE_TYPES, MAX_PHOTO_BYTES, extFromMime } from '../storage';

const ASSET_KINDS = new Set(['logo', 'banner', 'gallery']);

/** Gate: only managers/admins/owners may edit a store's look. */
async function requireBrandingEditor(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<never> | null> {
  const role = await getMyRole(ctx, storeId);
  if (!can.editBranding(role)) return fail('forbidden', 'Ikke tilgang til å redigere butikken');
  return null;
}

/** Persist a sanitised theme. Returns the sanitised theme actually stored. */
export async function saveStoreTheme(
  ctx: ServiceContext,
  storeId: string,
  themeInput: unknown,
): Promise<ServiceResult<{ theme: StoreTheme }>> {
  const denied = await requireBrandingEditor(ctx, storeId);
  if (denied) return denied;

  const theme = sanitizeStoreTheme(themeInput);
  const { error } = await ctx.admin.from('stores').update({ theme } as never).eq('id', storeId);
  if (error) {
    console.error('saveStoreTheme failed', error);
    return fail('server_error', 'Kunne ikke lagre tema');
  }
  return ok({ theme });
}

/** Persist a sanitised page config. Returns the sanitised config actually stored. */
export async function saveStorePage(
  ctx: ServiceContext,
  storeId: string,
  pageInput: unknown,
): Promise<ServiceResult<{ page_config: StorePageConfig }>> {
  const denied = await requireBrandingEditor(ctx, storeId);
  if (denied) return denied;

  const page_config = sanitizePageConfig(pageInput);
  const { error } = await ctx.admin.from('stores').update({ page_config } as never).eq('id', storeId);
  if (error) {
    console.error('saveStorePage failed', error);
    return fail('server_error', 'Kunne ikke lagre siden');
  }
  return ok({ page_config });
}

/** Apply a starter preset (theme + page_config) in one shot. */
export async function applyPreset(
  ctx: ServiceContext,
  storeId: string,
  presetId: string,
): Promise<ServiceResult<{ presetId: string }>> {
  const denied = await requireBrandingEditor(ctx, storeId);
  if (denied) return denied;

  const preset = getPreset(presetId);
  if (!preset) return fail('bad_input', `Ukjent forhåndsvalg (gyldige: ${STORE_PRESET_IDS.join(', ')})`);

  // Re-sanitise on the way in so a preset edit can never persist an invalid shape.
  const theme = sanitizeStoreTheme(preset.theme);
  const page_config = sanitizePageConfig(preset.page_config);

  const { error } = await ctx.admin
    .from('stores')
    .update({ theme, page_config } as never)
    .eq('id', storeId);
  if (error) {
    console.error('applyPreset failed', error);
    return fail('server_error', 'Kunne ikke bruke forhåndsvalget');
  }
  return ok({ presetId });
}

/** Clear the builder config so the store falls back to the platform default. */
export async function resetStorePage(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<{ ok: true }>> {
  const denied = await requireBrandingEditor(ctx, storeId);
  if (denied) return denied;
  const { error } = await ctx.admin
    .from('stores')
    .update({ theme: null, page_config: null } as never)
    .eq('id', storeId);
  if (error) return fail('server_error', 'Kunne ikke tilbakestille siden');
  return ok({ ok: true });
}

// ── Draft / publish model (Phase 2 editor) ─────────────────────────────
// The editor writes to the *_draft columns; the public storefront keeps
// rendering the LIVE theme/page_config until publishStoreDraft copies the
// (re-sanitised) draft across. Everything is re-sanitised on save AND on
// publish, so a bad draft can never reach the live storefront.

export interface StoreDraftInput {
  theme?: unknown;
  pageConfig?: unknown;
}

/** Persist a sanitised DRAFT theme and/or page config. Only the provided keys
 *  are written, so the editor can debounce-save either independently. */
export async function saveStoreDraft(
  ctx: ServiceContext,
  storeId: string,
  input: StoreDraftInput,
): Promise<ServiceResult<{ theme?: StoreTheme; page_config?: StorePageConfig }>> {
  const denied = await requireBrandingEditor(ctx, storeId);
  if (denied) return denied;

  const update: Record<string, unknown> = {};
  const out: { theme?: StoreTheme; page_config?: StorePageConfig } = {};
  if (input.theme !== undefined) {
    out.theme = sanitizeStoreTheme(input.theme);
    update.theme_draft = out.theme;
  }
  if (input.pageConfig !== undefined) {
    out.page_config = sanitizePageConfig(input.pageConfig);
    update.page_config_draft = out.page_config;
  }
  if (Object.keys(update).length === 0) return ok(out); // nothing to save

  const { error } = await ctx.admin.from('stores').update(update as never).eq('id', storeId);
  if (error) {
    console.error('saveStoreDraft failed', error);
    return fail('server_error', 'Kunne ikke lagre utkastet');
  }
  return ok(out);
}

/** Copy the draft to the live storefront (re-sanitising both), so a bad draft
 *  can never publish unsafe data. Keeps the draft mirrored to what went live. */
export async function publishStoreDraft(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<{ theme: StoreTheme; page_config: StorePageConfig }>> {
  const denied = await requireBrandingEditor(ctx, storeId);
  if (denied) return denied;

  // admin read: the service already authorised the caller above; RLS would
  // add nothing here and this row is store-scoped by id.
  const { data: store } = await ctx.admin
    .from('stores')
    .select('theme, page_config, theme_draft, page_config_draft')
    .eq('id', storeId)
    .maybeSingle();
  if (!store) return fail('not_found', 'Butikk ikke funnet');

  const s = store as Record<string, unknown>;
  const theme = sanitizeStoreTheme(s.theme_draft ?? s.theme);
  const page_config = sanitizePageConfig(s.page_config_draft ?? s.page_config);

  const { error } = await ctx.admin
    .from('stores')
    .update({ theme, page_config, theme_draft: theme, page_config_draft: page_config } as never)
    .eq('id', storeId);
  if (error) {
    console.error('publishStoreDraft failed', error);
    return fail('server_error', 'Kunne ikke publisere');
  }
  return ok({ theme, page_config });
}

/** Apply a starter preset to the DRAFT (not live), so the editor can preview
 *  it before publishing. */
export async function applyPresetToDraft(
  ctx: ServiceContext,
  storeId: string,
  presetId: string,
): Promise<ServiceResult<{ presetId: string; theme: StoreTheme; page_config: StorePageConfig }>> {
  const denied = await requireBrandingEditor(ctx, storeId);
  if (denied) return denied;

  const preset = getPreset(presetId);
  if (!preset) return fail('bad_input', `Ukjent forhåndsvalg (gyldige: ${STORE_PRESET_IDS.join(', ')})`);

  const theme = sanitizeStoreTheme(preset.theme);
  const page_config = sanitizePageConfig(preset.page_config);
  const { error } = await ctx.admin
    .from('stores')
    .update({ theme_draft: theme, page_config_draft: page_config } as never)
    .eq('id', storeId);
  if (error) {
    console.error('applyPresetToDraft failed', error);
    return fail('server_error', 'Kunne ikke bruke forhåndsvalget');
  }
  return ok({ presetId, theme, page_config });
}

/** Clear the DRAFT back to empty (platform default) so the editor resets. Live
 *  stays untouched until the next publish. */
export async function resetStoreDraft(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<{ ok: true }>> {
  const denied = await requireBrandingEditor(ctx, storeId);
  if (denied) return denied;
  const { error } = await ctx.admin
    .from('stores')
    .update({ theme_draft: null, page_config_draft: null } as never)
    .eq('id', storeId);
  if (error) return fail('server_error', 'Kunne ikke tilbakestille utkastet');
  return ok({ ok: true });
}

/** Upload a store asset (logo/banner/gallery) and record a store_assets row. */
export async function uploadStoreAsset(
  ctx: ServiceContext,
  storeId: string,
  kind: string,
  file: File,
  alt?: string | null,
): Promise<ServiceResult<{ asset: StorefrontAsset }>> {
  const denied = await requireBrandingEditor(ctx, storeId);
  if (denied) return denied;

  if (!ASSET_KINDS.has(kind)) return fail('bad_input', 'Ugyldig bildetype');
  if (!(file instanceof File) || file.size === 0) return fail('bad_input', 'Mangler fil');
  if (file.size > MAX_PHOTO_BYTES) return fail('bad_input', 'Bildet er for stort (maks 10 MB)');
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return fail('bad_input', 'Ugyldig filtype');

  // Store under the uploader's own folder so the 0003 storage RLS
  // (foldername[1] = auth.uid()) accepts it even on a direct client upload.
  const ext = extFromMime(file.type);
  const path = `${ctx.user.id}/stores/${storeId}/${kind}-${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await ctx.admin.storage
    .from('projects')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) {
    console.error('uploadStoreAsset upload failed', upErr);
    return fail('server_error', 'Kunne ikke laste opp bilde');
  }

  // Append at the end of the store's asset order.
  const { data: last } = await ctx.admin
    .from('store_assets')
    .select('position')
    .eq('store_id', storeId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last?.position as number | undefined) ?? -1) + 1;

  const { data: row, error: insErr } = await ctx.admin
    .from('store_assets')
    .insert({ store_id: storeId, path, kind, alt: alt?.trim() || null, position } as never)
    .select('id, path, kind, alt, position')
    .single();
  if (insErr || !row) {
    console.error('uploadStoreAsset insert failed', insErr);
    // Roll back the orphaned upload so storage doesn't accumulate junk.
    await ctx.admin.storage.from('projects').remove([path]).catch(() => {});
    return fail('server_error', 'Kunne ikke lagre bilde');
  }

  return ok({ asset: row as unknown as StorefrontAsset });
}

/** List a store's assets (member-gated; for the Phase 2 admin/editor UI). */
export async function listStoreAssets(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<StorefrontAsset[]>> {
  const role = await getMyRole(ctx, storeId);
  if (!role) return fail('forbidden', 'Ikke medlem av butikken');
  const { data, error } = await ctx.admin
    .from('store_assets')
    .select('id, path, kind, alt, position')
    .eq('store_id', storeId)
    .order('position');
  if (error) return fail('server_error', 'Kunne ikke hente bilder');
  return ok((data ?? []) as unknown as StorefrontAsset[]);
}

/** Delete a store asset row + its file. */
export async function deleteStoreAsset(
  ctx: ServiceContext,
  storeId: string,
  assetId: string,
): Promise<ServiceResult<{ ok: true }>> {
  const denied = await requireBrandingEditor(ctx, storeId);
  if (denied) return denied;

  const { data: asset } = await ctx.admin
    .from('store_assets')
    .select('id, path')
    .eq('id', assetId)
    .eq('store_id', storeId) // pin to this store
    .maybeSingle();
  if (!asset) return fail('not_found', 'Bilde ikke funnet');

  const { error } = await ctx.admin.from('store_assets').delete().eq('id', assetId).eq('store_id', storeId);
  if (error) return fail('server_error', 'Kunne ikke slette bilde');
  await ctx.admin.storage.from('projects').remove([(asset as { path: string }).path]).catch(() => {});
  return ok({ ok: true });
}
