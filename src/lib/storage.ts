const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL ?? '';

export function projectPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/projects/${path}`;
}

/**
 * Turn a Supabase public-object URL into a resized, quality-optimised thumbnail
 * via the storage image-transformation endpoint. Grid cards otherwise pull the
 * full upload (up to MAX_PHOTO_BYTES = 10 MB) at display sizes of ~200-400px.
 *
 * Safe by construction: returns the input unchanged if it isn't a Supabase
 * public-object URL (e.g. a pattern cover from the content collection, or null),
 * so callers can wrap any image URL without special-casing.
 */
export function resizedImageUrl(
  objectUrl: string | null | undefined,
  width: number,
  quality = 70,
): string | null {
  if (!objectUrl) return null;
  const rendered = objectUrl.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  if (rendered === objectUrl) return objectUrl; // not a Supabase public-object URL
  const sep = rendered.includes('?') ? '&' : '?';
  return `${rendered}${sep}width=${width}&quality=${quality}`;
}

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
]);

// Pattern uploads accept PDFs as well as images (cover photos / scanned magazines).
export const ALLOWED_PATTERN_TYPES = new Set([
  ...ALLOWED_IMAGE_TYPES,
  'application/pdf',
]);

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PATTERN_BYTES = 25 * 1024 * 1024;

export function patternFileExt(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  return extFromMime(mime);
}

export function extFromMime(mime: string, fallback = 'jpg'): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/avif':
      return 'avif';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    default:
      return fallback;
  }
}
