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

/** Listing/commission category → ordered list of category-relevant samples. */
export const SAMPLE_IMAGES: Record<string, string[]> = {
  genser:   [s('sage-sweater'), s('autumn-cable'), s('terracotta-knit')],
  cardigan: [s('brown-wool'), s('terracotta-knit'), s('autumn-cable')],
  jakke:    [s('brown-wool'), s('terracotta-knit')],
  lue:      [s('mustard-knit'), s('texture-close')],
  bukser:   [s('brown-wool'), s('texture-close')],
  sokker:   [s('texture-close'), s('mustard-knit')],
  votter:   [s('texture-close'), s('mustard-knit')],
  teppe:    [s('cream-flatlay'), s('autumn-cable')],
  kjole:    [s('colorful-tshirt'), s('cream-flatlay')],
  body:     [s('cream-flatlay'), s('colorful-tshirt')],
  annet:    [s('texture-close'), s('grey-yarn-balls')],
};

/** First (hero) sample for a category, with a safe fallback. */
export function heroSample(category: string): string {
  const list = SAMPLE_IMAGES[category] ?? SAMPLE_IMAGES.annet;
  return list[0];
}

/** N category-relevant sample paths (cycles the list if N exceeds it). */
export function samplesFor(category: string, count: number): string[] {
  const list = SAMPLE_IMAGES[category] ?? SAMPLE_IMAGES.annet;
  return Array.from({ length: count }, (_, i) => list[i % list.length]);
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
