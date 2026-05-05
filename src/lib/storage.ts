const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL ?? '';

export function projectPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/projects/${path}`;
}

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
]);

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

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
