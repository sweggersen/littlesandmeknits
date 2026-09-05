import { describe, it, expect } from 'vitest';
import { resizedImageUrl } from './storage';

const OBJ = 'https://x.supabase.co/storage/v1/object/public/projects/abc/hero.jpg';

describe('resizedImageUrl', () => {
  it('rewrites a Supabase public-object URL to a resized render URL', () => {
    const r = resizedImageUrl(OBJ, 500);
    expect(r).toBe('https://x.supabase.co/storage/v1/render/image/public/projects/abc/hero.jpg?width=500&quality=70');
  });

  it('honours a custom quality', () => {
    expect(resizedImageUrl(OBJ, 800, 60)).toContain('width=800&quality=60');
  });

  it('appends with & when the URL already has a query string', () => {
    const r = resizedImageUrl(`${OBJ}?token=t`, 400);
    expect(r).toBe('https://x.supabase.co/storage/v1/render/image/public/projects/abc/hero.jpg?token=t&width=400&quality=70');
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
