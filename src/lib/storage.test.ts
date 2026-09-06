import { describe, it, expect } from 'vitest';
import { resizedImageUrl, squareThumbUrl } from './storage';

const OBJ = 'https://x.supabase.co/storage/v1/object/public/projects/abc/hero.jpg';
const RENDER = 'https://x.supabase.co/storage/v1/render/image/public/projects/abc/hero.jpg';

describe('resizedImageUrl', () => {
  it('rewrites a Supabase public-object URL to a resized render URL', () => {
    expect(resizedImageUrl(OBJ, 500)).toBe(`${RENDER}?width=500&quality=70`);
  });

  it('honours a custom quality', () => {
    expect(resizedImageUrl(OBJ, 800, { quality: 60 })).toContain('width=800&quality=60');
  });

  it('adds height + resize=cover so the aspect ratio is preserved (the squished-sliver bug)', () => {
    // Without height the render endpoint keeps the ORIGINAL height, distorting
    // the image; height + resize=cover pins the output to the container ratio.
    expect(resizedImageUrl(OBJ, 600, { height: 450 })).toBe(`${RENDER}?width=600&height=450&resize=cover&quality=70`);
  });

  it('defaults resize to cover but respects an explicit mode', () => {
    expect(resizedImageUrl(OBJ, 400, { height: 400, resize: 'contain' })).toContain('resize=contain');
  });

  it('appends with & when the URL already has a query string', () => {
    expect(resizedImageUrl(`${OBJ}?token=t`, 400)).toBe(`${RENDER}?token=t&width=400&quality=70`);
  });

  it('leaves a non-Supabase URL unchanged (safe passthrough)', () => {
    const ext = 'https://cdn.example.com/cover.png';
    expect(resizedImageUrl(ext, 500)).toBe(ext);
  });

  it('returns null for null/undefined/empty', () => {
    expect(resizedImageUrl(null, 500)).toBeNull();
    expect(resizedImageUrl(undefined, 500)).toBeNull();
    expect(resizedImageUrl('', 500)).toBeNull();
  });
});

describe('squareThumbUrl', () => {
  it('produces an NxN cover crop for square cards', () => {
    expect(squareThumbUrl(OBJ, 500)).toBe(`${RENDER}?width=500&height=500&resize=cover&quality=70`);
  });

  it('passes through null', () => {
    expect(squareThumbUrl(null, 500)).toBeNull();
  });
});
