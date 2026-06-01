// Store CRUD and storefront read service. Membership and invitations live in
// store-members.ts and store-invitations.ts so this file stays focused.

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { lookupOrgnr } from '../brreg';
import { ensureUniqueSlug, isReserved, isValidSlugSyntax, slugify } from './store-slug';
import { can } from './store-permissions';
import { getMyRole } from './store-members';
import type { Store, StoreStatus, PublicStorefront } from '../types/stores';

const STORE_SELECT = '*';

export interface CreateStoreInput {
  orgnr: string;
  /** Optional override for display name. Defaults to legal name from Brønnøysund. */
  name?: string;
  /** Optional slug. Defaults to slugified name. */
  slug?: string;
  tagline?: string;
  description?: string;
  website_url?: string;
  contact_email?: string;
}

export async function createStore(
  ctx: ServiceContext,
  input: CreateStoreInput,
): Promise<ServiceResult<{ storeId: string; slug: string; redirect: string }>> {
  if (!input.orgnr) return fail('bad_input', 'Orgnr er påkrevd');

  const contactEmail = input.contact_email?.trim().toLowerCase();
  if (!contactEmail) return fail('bad_input', 'Kontakt-e-post er påkrevd');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return fail('bad_input', 'Ugyldig e-postadresse');

  const lookup = await lookupOrgnr(input.orgnr);
  if (!lookup.ok || !lookup.data) {
    if (lookup.error === 'not_found') return fail('not_found', 'Fant ikke organisasjonen i Brønnøysundregistrene');
    if (lookup.error === 'invalid_format' || lookup.error === 'invalid_checksum') {
      return fail('bad_input', 'Ugyldig organisasjonsnummer');
    }
    return fail('server_error', 'Kunne ikke slå opp organisasjonen akkurat nå');
  }
  const org = lookup.data;
  if (org.status !== 'normal') {
    return fail('conflict', `Organisasjonen er registrert som ${org.status} i Brønnøysund og kan ikke brukes`);
  }

  // Orgnr must be unique among non-deleted stores
  const { data: existingOrgnr } = await ctx.admin
    .from('stores')
    .select('id')
    .eq('orgnr', org.orgnr)
    .is('deleted_at', null)
    .maybeSingle();
  if (existingOrgnr) return fail('conflict', 'Denne organisasjonen har allerede en butikk');

  const name = (input.name ?? org.legalName).trim();
  if (name.length < 2) return fail('bad_input', 'Navn er for kort');

  // Slug
  let slug: string;
  if (input.slug) {
    const candidate = input.slug.toLowerCase().trim();
    if (!isValidSlugSyntax(candidate)) return fail('bad_input', 'Ugyldig URL-navn (a-z, 0-9, bindestrek; 3-48 tegn)');
    if (isReserved(candidate)) return fail('conflict', 'Dette URL-navnet er reservert');
    const { data: taken } = await ctx.admin.from('stores').select('id').eq('slug', candidate).maybeSingle();
    if (taken) return fail('conflict', 'URL-navnet er allerede tatt');
    slug = candidate;
  } else {
    const generated = await ensureUniqueSlug(ctx.admin, slugify(name));
    if (!generated) return fail('server_error', 'Kunne ikke generere URL-navn');
    slug = generated;
  }

  const { data: store, error } = await ctx.admin
    .from('stores')
    .insert({
      slug,
      orgnr: org.orgnr,
      legal_name: org.legalName,
      legal_address: org.address || null,
      legal_business_type: org.businessType,
      legal_industry_code: org.industryCode,
      legal_status: org.status,
      legal_founded_date: org.foundedDate,
      name,
      tagline: input.tagline?.trim() || null,
      description: input.description?.trim() || null,
      website_url: input.website_url?.trim() || null,
      contact_email: contactEmail,
      location_city: org.city,
      status: 'pending_review' as StoreStatus,
      created_by: ctx.user.id,
    })
    .select('id, slug')
    .single();

  if (error || !store) {
    console.error('Store insert failed', error);
    // Postgres error 23505 = unique_violation. Distinguish slug vs orgnr.
    if (error && (error as any).code === '23505') {
      const detail = (error as any).message ?? '';
      if (detail.includes('slug')) return fail('conflict', 'URL-navnet er allerede tatt');
      if (detail.includes('orgnr')) return fail('conflict', 'Denne organisasjonen har allerede en butikk');
      return fail('conflict', 'Konflikt — prøv et annet navn eller orgnr');
    }
    return fail('server_error', 'Kunne ikke opprette butikk');
  }

  // Creator becomes Owner
  const { error: memberErr } = await ctx.admin.from('store_members').insert({
    store_id: store.id,
    user_id: ctx.user.id,
    role: 'owner',
    visible_on_storefront: true,
  });
  if (memberErr) {
    console.error('Owner membership insert failed', memberErr);
    // Roll back the store row to avoid orphan
    await ctx.admin.from('stores').delete().eq('id', store.id);
    return fail('server_error', 'Kunne ikke opprette eier-medlemskap');
  }

  // Enqueue for moderation
  const { data: queued, error: queueErr } = await ctx.admin
    .from('moderation_queue')
    .insert({
      item_type: 'store',
      item_id: store.id,
      submitter_id: ctx.user.id,
    })
    .select('id')
    .maybeSingle();
  if (queueErr) {
    console.error('Moderation queue insert failed for new store', queueErr);
  } else if (queued) {
    try {
      const { notifyModeratorsNewItem } = await import('../notify');
      await notifyModeratorsNewItem(ctx.admin, {
        itemType: 'store',
        itemId: store.id,
        queueId: queued.id,
        submitterId: ctx.user.id,
        title: name,
      }, ctx.env);
    } catch (err) {
      console.error('Moderator broadcast failed', err);
    }
  }

  return ok({
    storeId: store.id,
    slug: store.slug,
    redirect: `/market/store/${store.slug}/admin`,
  });
}

export interface UpdateStoreInput {
  name?: string;
  tagline?: string | null;
  description?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  website_url?: string | null;
  instagram_url?: string | null;
  etsy_url?: string | null;
  pinterest_url?: string | null;
  tiktok_url?: string | null;
  location_city?: string | null;
  accent_color?: string | null;
  opening_hours?: Record<string, string> | null;
  banner_path?: string | null;
  logo_path?: string | null;
}

export async function updateStore(
  ctx: ServiceContext,
  storeId: string,
  patch: UpdateStoreInput,
): Promise<ServiceResult<{ ok: true }>> {
  const role = await getMyRole(ctx, storeId);
  if (!can.editStoreSettings(role)) return fail('forbidden', 'Ikke tilgang til å redigere butikk');

  // Whitelist allowed fields (don't trust the client)
  const allowed: (keyof UpdateStoreInput)[] = [
    'name', 'tagline', 'description',
    'contact_email', 'contact_phone', 'website_url',
    'instagram_url', 'etsy_url', 'pinterest_url', 'tiktok_url',
    'location_city', 'accent_color', 'opening_hours',
    'banner_path', 'logo_path',
  ];
  const update: Partial<UpdateStoreInput> = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) (update[key] as unknown) = patch[key];
  }
  if (typeof update.name === 'string' && update.name.trim().length < 2) {
    return fail('bad_input', 'Navn er for kort');
  }

  const { error } = await ctx.admin.from('stores').update(update).eq('id', storeId);
  if (error) {
    console.error('Store update failed', error);
    return fail('server_error', 'Kunne ikke oppdatere butikk');
  }
  return ok({ ok: true });
}

/** Soft-delete a store. Recoverable for 90 days. Owner only. */
export async function softDeleteStore(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<{ ok: true }>> {
  const role = await getMyRole(ctx, storeId);
  if (!can.deleteStore(role)) return fail('forbidden', 'Bare eier kan slette butikk');

  const { error } = await ctx.admin
    .from('stores')
    // stores.status enum is draft/active/pending_review/suspended/archived;
    // 'archived' is the soft-deleted state.
    .update({ deleted_at: new Date().toISOString(), status: 'archived' })
    .eq('id', storeId);
  if (error) return fail('server_error', 'Kunne ikke slette butikk');

  // Hide store listings. Only archive listings that are NOT mid-sale.
  // reserved/shipped/sold/disputed must remain intact so the buyer flow
  // (delivery confirm, refund, dispute) keeps working.
  await ctx.admin
    .from('listings')
    .update({ status: 'removed' })
    .eq('store_id', storeId)
    .in('status', ['active', 'draft', 'pending_review']);

  return ok({ ok: true });
}

export async function restoreStore(
  ctx: ServiceContext,
  storeId: string,
): Promise<ServiceResult<{ ok: true }>> {
  const role = await getMyRole(ctx, storeId);
  if (!can.deleteStore(role)) return fail('forbidden', 'Bare eier kan gjenopprette butikk');

  const { error } = await ctx.admin
    .from('stores')
    .update({ deleted_at: null, status: 'pending_review' })
    .eq('id', storeId);
  if (error) return fail('server_error', 'Kunne ikke gjenopprette butikk');
  return ok({ ok: true });
}

const MAX_STORE_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_STORE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

/** Upload (or replace) a store's logo or banner. Uploaded images are
 *  pending moderator review until the store reaches active status — a
 *  freshly uploaded image on an active store gets a moderation queue
 *  entry of item_type='store_image'. */
export async function uploadStoreImage(
  ctx: ServiceContext,
  storeId: string,
  kind: 'logo' | 'banner',
  file: File,
): Promise<ServiceResult<{ path: string }>> {
  const role = await getMyRole(ctx, storeId);
  if (!can.editBranding(role)) return fail('forbidden', 'Ikke tilgang');

  if (file.size > MAX_STORE_IMAGE_BYTES) return fail('bad_input', 'Bildet er for stort (maks 5 MB)');
  if (!ALLOWED_STORE_IMAGE_TYPES.has(file.type)) return fail('bad_input', 'Ugyldig filtype (JPEG, PNG, WebP eller AVIF)');

  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif',
  };
  const ext = extMap[file.type] ?? 'jpg';
  const path = `stores/${storeId}/${kind}-${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await ctx.admin.storage
    .from('projects').upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) {
    console.error('Store image upload failed', upErr);
    return fail('server_error', 'Kunne ikke laste opp bilde');
  }

  // Delete old image (if any) so storage doesn't accumulate orphans.
  const pathField: 'logo_path' | 'banner_path' = kind === 'logo' ? 'logo_path' : 'banner_path';
  const { data: prev } = await ctx.admin.from('stores').select(pathField).eq('id', storeId).maybeSingle();
  const prevPath = prev ? (prev as Record<typeof pathField, string | null>)[pathField] : null;
  if (prevPath && prevPath !== path) {
    await ctx.admin.storage.from('projects').remove([prevPath]).catch(() => {});
  }

  const { error: updErr } = await ctx.admin
    .from('stores').update({ [pathField]: path }).eq('id', storeId);
  if (updErr) {
    console.error('Store image update failed', updErr);
    return fail('server_error', 'Kunne ikke lagre bilde');
  }

  // If the store is already active, queue the new image for moderation.
  // Drafts and pending_review stores get reviewed as part of the original
  // store moderation pass.
  const { data: store } = await ctx.admin.from('stores').select('status').eq('id', storeId).maybeSingle();
  if (store?.status === 'active') {
    await ctx.admin.from('moderation_queue').insert({
      item_type: 'store_image',
      item_id: storeId,
      submitter_id: ctx.user.id,
    }).select('id').maybeSingle();
  }

  return ok({ path });
}

/** Public-storefront read. Returns null if the store is not publicly visible. */
export async function getPublicStorefront(
  ctx: ServiceContext,
  slug: string,
): Promise<ServiceResult<PublicStorefront>> {
  const { data: store } = await ctx.supabase
    .from('stores')
    .select(STORE_SELECT)
    .eq('slug', slug)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle<Store>();
  if (!store) return fail('not_found', 'Butikk ikke funnet');

  const { data: members } = await ctx.supabase
    .from('store_members')
    .select('user_id, public_title, role, profiles:profiles!store_members_user_id_fkey(display_name, avatar_path)')
    .eq('store_id', store.id)
    .eq('visible_on_storefront', true);

  const publicMembers = (members ?? []).map((m: any) => ({
    user_id: m.user_id,
    public_title: m.public_title,
    role: m.role,
    display_name: m.profiles?.display_name ?? null,
    avatar_path: m.profiles?.avatar_path ?? null,
  }));

  return ok({
    store: {
      id: store.id,
      slug: store.slug,
      name: store.name,
      tagline: store.tagline,
      description: store.description,
      banner_path: store.banner_path,
      logo_path: store.logo_path,
      accent_color: store.accent_color,
      location_city: store.location_city,
      contact_email: store.contact_email,
      contact_phone: store.contact_phone,
      website_url: store.website_url,
      instagram_url: store.instagram_url,
      etsy_url: store.etsy_url,
      pinterest_url: store.pinterest_url,
      tiktok_url: store.tiktok_url,
      opening_hours: store.opening_hours,
      verified: store.verified,
      legal_name: store.legal_name,
      legal_address: store.legal_address,
      created_at: store.created_at,
    },
    publicMembers,
  });
}

/** Stores that the current user is a member of. Includes soft-deleted
 *  ones (with status='archived', deleted_at not null) so the user can
 *  restore them within the 90-day window. */
export async function listMyStores(ctx: ServiceContext): Promise<ServiceResult<Array<Store & { my_role: string }>>> {
  const { data, error } = await ctx.admin
    .from('store_members')
    .select('role, stores:stores!inner(*)')
    .eq('user_id', ctx.user.id);
  if (error) return fail('server_error', 'Kunne ikke hente butikker');
  const rows = (data ?? []).map((r: any) => ({ ...r.stores, my_role: r.role }));
  return ok(rows);
}

/** Internal: fetch a store by id (admin client, no RLS). */
export async function getStoreByIdAdmin(
  ctx: ServiceContext,
  storeId: string,
): Promise<Store | null> {
  const { data } = await ctx.admin.from('stores').select(STORE_SELECT).eq('id', storeId).maybeSingle<Store>();
  return data;
}

export async function getStoreBySlugAdmin(
  ctx: ServiceContext,
  slug: string,
): Promise<Store | null> {
  const { data } = await ctx.admin.from('stores').select(STORE_SELECT).eq('slug', slug).maybeSingle<Store>();
  return data;
}
