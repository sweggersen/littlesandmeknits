// Store CRUD and storefront read service. Membership and invitations live in
// store-members.ts and store-invitations.ts so this file stays focused.

import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';
import { lookupOrgnr, type OrgnrData } from '../brreg';
import { ensureUniqueSlug, isReserved, isValidSlugSyntax, slugify } from './store-slug';
import { can } from './store-permissions';
import { getMyRole } from './store-members';
import { assertWithinQuota } from './quota';
import { recordDeadLetter } from './dead-letter';
import { geocodePostnummer } from '../geocode';
import type { Store, StoreStatus, PublicStorefront } from '../types/stores';

const STORE_SELECT = '*';

/** Validate a Norwegian 4-digit postal code. Returns the cleaned value or null. */
function cleanPostnummer(raw: string | null | undefined): string | null {
  const pn = (raw ?? '').replace(/\D/g, '');
  return pn.length === 4 ? pn : null;
}

/** Geocode a store's postnummer to a COARSE area centroid and persist
 *  lat/lng/geocoded_at. Best-effort: on any failure it dead-letters and leaves
 *  the coords null (the store just won't appear in the "Nærmest" sort), never
 *  blocking the caller. Never geocodes the exact address. */
async function geocodeStoreCoords(
  ctx: ServiceContext,
  storeId: string,
  postnummer: string,
  city: string | null,
): Promise<void> {
  const point = await geocodePostnummer(postnummer, city);
  if (!point) {
    await recordDeadLetter(ctx, {
      service: 'stores.geocode',
      context: { storeId, postnummer },
      error: 'Kartverket returned no coordinate for postnummer',
    });
    return;
  }
  const { error } = await ctx.admin
    .from('stores')
    .update({ lat: point.lat, lng: point.lng, geocoded_at: new Date().toISOString() } as never)
    .eq('id', storeId);
  if (error) {
    await recordDeadLetter(ctx, {
      service: 'stores.geocode',
      context: { storeId, postnummer },
      error,
    });
  }
}

export interface CreateStoreInput {
  /** Optional. When present + valid, the store is a verified business. When
   *  absent/empty, it's a personal store (profile page) with verified=false. */
  orgnr?: string;
  /** Display name. Defaults to the Brønnøysund legal name for business stores;
   *  REQUIRED for personal stores (there is no legal name to fall back to). */
  name?: string;
  /** Optional slug. Defaults to slugified name. */
  slug?: string;
  tagline?: string;
  description?: string;
  website_url?: string;
  contact_email?: string;
  /** Public city (poststed), from the address autocomplete. Falls back to the
   *  Brønnøysund city for business stores. */
  location_city?: string;
  /** Public 4-digit postal code. Required — the geocode key + public location. */
  postnummer?: string;
  /** Required exact address. PRIVATE (store_private_details) — fraud/verification
   *  only, never public, never geocoded. */
  precise_address?: string;
}

export async function createStore(
  ctx: ServiceContext,
  input: CreateStoreInput,
): Promise<ServiceResult<{ storeId: string; slug: string; redirect: string }>> {
  // orgnr is now optional: a store WITH a valid org number is a verified
  // business; one WITHOUT is a personal store/profile page. `verified` and
  // `status` are decided here (server-controlled), never taken from input.
  const rawOrgnr = input.orgnr?.trim();
  const hasOrgnr = !!rawOrgnr;

  const contactEmail = input.contact_email?.trim().toLowerCase();
  if (!contactEmail) return fail('bad_input', 'Kontakt-e-post er påkrevd');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return fail('bad_input', 'Ugyldig e-postadresse');

  // Address is required (fraud/verification signal). The postnummer is public
  // (city + postnummer); the exact address stays private.
  const postnummer = cleanPostnummer(input.postnummer);
  if (!postnummer) return fail('bad_input', 'Gyldig postnummer (4 siffer) er påkrevd');
  const preciseAddress = input.precise_address?.trim();
  if (!preciseAddress || preciseAddress.length < 5) return fail('bad_input', 'Adresse er påkrevd');

  // Back-pressure BEFORE the Brønnøysund lookup + writes (spam-store flooding).
  const quotaFail = await assertWithinQuota(ctx, 'store_create');
  if (quotaFail) return quotaFail;

  // Business path: resolve + validate the org against Brønnøysund. Personal
  // path skips the lookup entirely (org stays null).
  let org: OrgnrData | null = null;
  if (hasOrgnr) {
    const lookup = await lookupOrgnr(rawOrgnr!);
    if (!lookup.ok || !lookup.data) {
      if (lookup.error === 'not_found') return fail('not_found', 'Fant ikke organisasjonen i Brønnøysundregistrene');
      if (lookup.error === 'invalid_format' || lookup.error === 'invalid_checksum') {
        return fail('bad_input', 'Ugyldig organisasjonsnummer');
      }
      return fail('server_error', 'Kunne ikke slå opp organisasjonen akkurat nå');
    }
    org = lookup.data;
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
  }

  // For a personal store there is no legal name to fall back to, so a display
  // name is required.
  const name = (input.name ?? org?.legalName ?? '').trim();
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
      // Business fields come from Brønnøysund; all null for a personal store.
      orgnr: org?.orgnr ?? null,
      legal_name: org?.legalName ?? null,
      legal_address: org?.address || null,
      legal_business_type: org?.businessType ?? null,
      legal_industry_code: org?.industryCode ?? null,
      legal_status: org?.status ?? null,
      legal_founded_date: org?.foundedDate ?? null,
      name,
      tagline: input.tagline?.trim() || null,
      description: input.description?.trim() || null,
      website_url: input.website_url?.trim() || null,
      contact_email: contactEmail,
      // Prefer the entered address city; fall back to the Brønnøysund city.
      location_city: input.location_city?.trim() || org?.city || null,
      postnummer,
      // Server-controlled: both personal and business stores go through
      // moderation; only a valid org number earns the verified badge.
      status: 'pending_review' as StoreStatus,
      verified: hasOrgnr,
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

  // Persist the required PRIVATE address (fraud/verification). Separate table,
  // members+staff RLS only — never public. Roll the store back if this fails so
  // a store can't exist without its address on record.
  const { error: pdErr } = await ctx.admin
    .from('store_private_details')
    .insert({ store_id: store.id, precise_address: preciseAddress } as never);
  if (pdErr) {
    console.error('store_private_details insert failed', pdErr);
    await ctx.admin.from('stores').delete().eq('id', store.id);
    return fail('server_error', 'Kunne ikke lagre adresse');
  }

  // Coarse geocode from the postnummer (best-effort, dead-letters on failure).
  await geocodeStoreCoords(ctx, store.id, postnummer, org?.city ?? null);

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
  postnummer?: string | null;
  /** PRIVATE exact address — written to store_private_details, never `stores`. */
  precise_address?: string | null;
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

  // Whitelist allowed fields (don't trust the client). precise_address is NOT
  // here — it's private and goes to store_private_details, never `stores`.
  // precise_address is excluded — it's a store_private_details column, never a
  // `stores` column, so it must not appear in the typed stores update payload.
  type StoreColumnPatch = Omit<UpdateStoreInput, 'precise_address'>;
  const allowed: (keyof StoreColumnPatch)[] = [
    'name', 'tagline', 'description',
    'contact_email', 'contact_phone', 'website_url',
    'instagram_url', 'etsy_url', 'pinterest_url', 'tiktok_url',
    'location_city', 'postnummer', 'accent_color', 'opening_hours',
    'banner_path', 'logo_path',
  ];

  // Validate postnummer when the client sent one. Narrowed to string|undefined
  // (an invalid value returns above) so the geocode call below type-checks.
  let postnummer: string | undefined;
  if (patch.postnummer !== undefined) {
    const cleaned = cleanPostnummer(patch.postnummer);
    if (!cleaned) return fail('bad_input', 'Gyldig postnummer (4 siffer) er påkrevd');
    postnummer = cleaned;
  }

  // Address is required: reject an explicit empty value. Omitting the key
  // leaves the stored address untouched, so edits to other fields still work.
  let preciseAddress: string | undefined;
  if (patch.precise_address !== undefined) {
    const trimmed = (patch.precise_address ?? '').trim();
    if (trimmed.length < 5) return fail('bad_input', 'Adresse er påkrevd');
    preciseAddress = trimmed;
  }

  const update: Partial<StoreColumnPatch> = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) (update[key] as unknown) = patch[key];
  }
  if (postnummer !== undefined) update.postnummer = postnummer;
  if (typeof update.name === 'string' && update.name.trim().length < 2) {
    return fail('bad_input', 'Navn er for kort');
  }

  // Current row: detect a real postnummer change + get the city for geocoding.
  const { data: current } = await ctx.admin
    .from('stores').select('postnummer, location_city').eq('id', storeId).maybeSingle();
  const currentPostnummer = (current as { postnummer?: string | null } | null)?.postnummer ?? null;
  const city =
    (typeof update.location_city === 'string'
      ? update.location_city
      : (current as { location_city?: string | null } | null)?.location_city) ?? null;

  const { error } = await ctx.admin.from('stores').update(update).eq('id', storeId);
  if (error) {
    console.error('Store update failed', error);
    return fail('server_error', 'Kunne ikke oppdatere butikk');
  }

  // Persist the private address (upsert; legacy stores have no row yet).
  if (preciseAddress !== undefined) {
    const { error: pdErr } = await ctx.admin
      .from('store_private_details')
      .upsert({ store_id: storeId, precise_address: preciseAddress, updated_at: new Date().toISOString() } as never);
    if (pdErr) {
      console.error('store_private_details upsert failed', pdErr);
      return fail('server_error', 'Kunne ikke lagre adresse');
    }
  }

  // Re-geocode only when the postnummer actually changed (coarse, best-effort).
  if (postnummer !== undefined && postnummer !== currentPostnummer) {
    await geocodeStoreCoords(ctx, storeId, postnummer, city);
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
    .from('stores').update({ [pathField]: path } as never).eq('id', storeId);
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
      postnummer: store.postnummer,
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
  // SOFT_DELETE_EXCEPTION_NOTE: admin lookups intentionally surface
  // soft-deleted stores so support can investigate them before the 90-day
  // purge. Public storefront resolution uses getStoreBySlug (which filters).
  const { data } = await ctx.admin.from('stores').select(STORE_SELECT).eq('slug', slug).maybeSingle<Store>();
  return data;
}
