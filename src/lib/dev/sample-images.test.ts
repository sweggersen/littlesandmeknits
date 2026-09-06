import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SAMPLE_IMAGES, SAMPLE_IMAGE_NAMES, heroSample, samplesFor,
  AVATAR_SAMPLES, STORE_LOGO_SAMPLES, STORE_BANNER_SAMPLES, LIBRARY_COVER_SAMPLES, YARN_SAMPLE,
} from './sample-images';
import { VALID_CATEGORIES } from '../labels';
// The Node hydrator's name list must match the app-side one (they drift apart
// otherwise → broken thumbnails for whole categories).
import { SAMPLE_NAMES } from '../../../scripts/seed-sample-images.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const basename = (p: string) => path.basename(p, '.jpg');

describe('sample-images (dev seed image contract)', () => {
  it('every listing/commission category maps to at least one _samples image', () => {
    for (const cat of VALID_CATEGORIES) {
      const list = SAMPLE_IMAGES[cat];
      expect(list, `category "${cat}" has no sample images`).toBeTruthy();
      expect(list.length).toBeGreaterThanOrEqual(1);
      for (const p of list) expect(p).toMatch(/^_samples\/.+\.jpg$/);
    }
  });

  it('heroSample + samplesFor resolve for every category and fall back safely', () => {
    for (const cat of VALID_CATEGORIES) {
      expect(heroSample(cat)).toMatch(/^_samples\/.+\.jpg$/);
      expect(samplesFor(cat, 3)).toHaveLength(3);
    }
    // Unknown category falls back to the `annet` set, never throws/empty.
    expect(heroSample('does-not-exist')).toMatch(/^_samples\/.+\.jpg$/);
    expect(samplesFor('does-not-exist', 2)).toHaveLength(2);
  });

  it('every referenced sample basename is a known, hydrated name', () => {
    const known = new Set(SAMPLE_IMAGE_NAMES);
    const referenced = [
      ...Object.values(SAMPLE_IMAGES).flat(),
      ...AVATAR_SAMPLES, ...STORE_LOGO_SAMPLES, ...STORE_BANNER_SAMPLES,
      ...LIBRARY_COVER_SAMPLES, YARN_SAMPLE,
    ];
    for (const p of referenced) {
      expect(known.has(basename(p)), `${p} references an unknown sample name`).toBe(true);
    }
  });

  it('the app name list and the Node hydrator name list are in sync', () => {
    expect([...SAMPLE_IMAGE_NAMES].sort()).toEqual([...SAMPLE_NAMES].sort());
  });

  it('every hydrated sample has a source JPEG in src/assets/img', () => {
    for (const name of SAMPLE_IMAGE_NAMES) {
      const p = path.join(REPO_ROOT, 'src/assets/img', `${name}.jpg`);
      expect(fs.existsSync(p), `missing source image: ${p}`).toBe(true);
    }
  });
});
