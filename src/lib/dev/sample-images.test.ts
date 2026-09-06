import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SAMPLE_IMAGES, SAMPLE_IMAGE_NAMES, heroSample, heroAt, photosAt, samplesFor,
  nextPhotos, resetPhotoRotation,
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

  it('every category has a pool of at least 3 samples (so same-category cards vary)', () => {
    for (const cat of VALID_CATEGORIES) {
      expect(SAMPLE_IMAGES[cat].length, `category "${cat}" pool too small`).toBeGreaterThanOrEqual(3);
    }
  });

  it('each category has a DISTINCT hero image (first card of every category differs)', () => {
    const heads = [...VALID_CATEGORIES].map((c) => heroAt(c, 0));
    expect(new Set(heads).size, `category heads collide: ${heads.join(', ')}`).toBe(heads.length);
  });

  it('heroAt rotates: consecutive indices pick different photos within a category', () => {
    for (const cat of VALID_CATEGORIES) {
      const pool = SAMPLE_IMAGES[cat];
      // Across one full rotation, adjacent indices never repeat.
      for (let i = 0; i < pool.length; i++) {
        expect(heroAt(cat, i)).not.toBe(heroAt(cat, i + 1));
      }
      // One full lap through the pool yields every distinct image.
      const lap = new Set(Array.from({ length: pool.length }, (_, i) => heroAt(cat, i)));
      expect(lap.size).toBe(pool.length);
    }
    // Negative/large indices are handled without throwing.
    expect(heroAt('genser', -1)).toMatch(/^_samples\/.+\.jpg$/);
  });

  it('photosAt returns distinct photos within a listing until the pool is exhausted', () => {
    const three = photosAt('genser', 0, 3);
    expect(new Set(three).size).toBe(3);
    expect(three[0]).toBe(heroAt('genser', 0)); // hero == first photo
  });

  it('nextPhotos rotates per category so consecutive same-category heroes differ', () => {
    resetPhotoRotation();
    const pool = SAMPLE_IMAGES.genser;
    // First `pool.length` genser listings each get a distinct hero.
    const heroes = Array.from({ length: pool.length }, () => nextPhotos('genser', 2)[0]);
    expect(new Set(heroes).size).toBe(pool.length);
    // A different category has its OWN counter (starts fresh at pool head).
    resetPhotoRotation();
    expect(nextPhotos('lue', 1)[0]).toBe(heroAt('lue', 0));
    expect(nextPhotos('genser', 1)[0]).toBe(heroAt('genser', 0));
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
