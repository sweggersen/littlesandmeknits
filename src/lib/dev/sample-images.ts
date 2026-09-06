// Category → sample-image mapping for the dev seed. The image BYTES are NOT
// bundled here (that would bloat the deployed Worker) — only the string paths.
// The real JPEGs live in src/assets/img/ and are hydrated into the storage
// bucket under projects/_samples/ by scripts/seed-sample-images.mjs
// (`npm run seed:samples`). Keep SAMPLE_IMAGE_NAMES in sync with that script's
// NAMES list — src/lib/dev/sample-images.test.ts fails if they drift.
//
// Mapped so a listing/project/etc. shows a fitting picture: a "genser" shows a
// sweater, a "teppe" a blanket flatlay, "lue" a hat, yarn shows yarn, and so on.

/** Basenames hydrated into projects/_samples/<name>.jpg. */
export const SAMPLE_IMAGE_NAMES = [
  'sage-sweater', 'autumn-cable', 'terracotta-knit', 'brown-wool', 'mustard-knit',
  'cream-flatlay', 'colorful-tshirt', 'texture-close', 'hands-knitting', 'grey-yarn-balls',
] as const;

const s = (name: string) => `_samples/${name}.jpg`;

// Each category carries SEVERAL plausible samples (not one) so same-category
// listings don't all show the identical photo. With only 10 source images we
// can't give every listing a globally-unique picture offline — that's what
// `npm run seed:photos` (Wikimedia, distinct per listing) is for — but a rotated
// pool of 3-4 per category kills the "every genser is the same photo" look.
// Each category's HEAD image ([0], the hero of its first listing) is DISTINCT
// across the nine categories, so the first card of every category shows a
// different photo — with 9 categories and 10 source images this is achievable
// and kills the "every category looks the same" clustering. Deeper pool members
// are shared (only 10 images exist), so heroAt/nextPhotos rotate within each
// category. For fully-unique per-listing photos, `npm run seed:photos`.
/** Listing/commission category → ordered list of category-relevant samples. */
export const SAMPLE_IMAGES: Record<string, string[]> = {
  genser:   [s('sage-sweater'), s('autumn-cable'), s('terracotta-knit'), s('brown-wool')],
  cardigan: [s('brown-wool'), s('terracotta-knit'), s('sage-sweater'), s('autumn-cable')],
  jakke:    [s('brown-wool'), s('terracotta-knit'), s('autumn-cable')],
  lue:      [s('mustard-knit'), s('texture-close'), s('autumn-cable')],
  bukser:   [s('autumn-cable'), s('brown-wool'), s('texture-close')],
  sokker:   [s('colorful-tshirt'), s('texture-close'), s('mustard-knit')],
  votter:   [s('texture-close'), s('mustard-knit'), s('brown-wool')],
  teppe:    [s('cream-flatlay'), s('autumn-cable'), s('sage-sweater')],
  kjole:    [s('terracotta-knit'), s('colorful-tshirt'), s('cream-flatlay')],
  body:     [s('cream-flatlay'), s('colorful-tshirt'), s('texture-close')],
  annet:    [s('grey-yarn-balls'), s('texture-close'), s('colorful-tshirt'), s('cream-flatlay')],
};

const poolFor = (category: string): string[] => SAMPLE_IMAGES[category] ?? SAMPLE_IMAGES.annet;

/** First (hero) sample for a category, with a safe fallback. */
export function heroSample(category: string): string {
  return poolFor(category)[0];
}

/**
 * Rotated hero for a category. Pass a monotonically increasing per-listing index
 * so consecutive same-category listings pick DIFFERENT photos out of the pool.
 */
export function heroAt(category: string, index: number): string {
  const pool = poolFor(category);
  return pool[((index % pool.length) + pool.length) % pool.length];
}

/**
 * N category-relevant sample paths for a listing, starting at `index` so the
 * hero (paths[0]) rotates per listing. Distinct within the listing until the
 * pool is exhausted.
 */
export function photosAt(category: string, index: number, count: number): string[] {
  const pool = poolFor(category);
  return Array.from({ length: count }, (_, i) => pool[(index + i) % pool.length]);
}

/** N category-relevant sample paths starting from the pool head (no rotation). */
export function samplesFor(category: string, count: number): string[] {
  return photosAt(category, 0, count);
}

// Stateful per-category rotation shared across a single seed run (seedWorld's
// listing photos via test-exec AND seed-full's catalogue/store listings all call
// `nextPhotos`), so consecutive listings of the same category never get the same
// hero until that category's pool is exhausted. Reset once per run for
// determinism. Module state persists within one request (the seed runs in one),
// which is all that's needed; it's dev-only tooling.
const _catCounters = new Map<string, number>();

/** Reset the per-category rotation. Call once at the start of a seed run. */
export function resetPhotoRotation(): void {
  _catCounters.clear();
}

/**
 * Next rotated set of `count` category-relevant photos for a listing, advancing
 * the per-category counter so the hero (paths[0]) differs from the previous
 * same-category listing.
 */
export function nextPhotos(category: string, count: number): string[] {
  const i = _catCounters.get(category) ?? 0;
  _catCounters.set(category, i + 1);
  return photosAt(category, i, count);
}

// Non-listing visual entities. Reuse the same hydrated files so no entity ever
// renders a broken thumbnail.
export const YARN_SAMPLE = s('grey-yarn-balls');
export const LIBRARY_COVER_SAMPLES = [s('sage-sweater'), s('mustard-knit'), s('terracotta-knit')];
export const STORE_LOGO_SAMPLES = [s('mustard-knit'), s('sage-sweater'), s('terracotta-knit')];
export const STORE_BANNER_SAMPLES = [s('cream-flatlay'), s('autumn-cable'), s('texture-close')];
// A knitterly stand-in avatar (hands at work / knit texture) — better than
// initials-only circles for reviewing the avatar UI.
export const AVATAR_SAMPLES = [
  s('hands-knitting'), s('texture-close'), s('grey-yarn-balls'),
  s('mustard-knit'), s('sage-sweater'), s('terracotta-knit'),
];
