import { describe, it, expect } from 'vitest';
import { resolveRedirect } from './redirects';

describe('resolveRedirect', () => {
  it('redirects /marked to /market', () => {
    expect(resolveRedirect('/marked')).toEqual({ location: '/market', status: 301 });
  });

  it('preserves sub-path beyond prefix', () => {
    expect(resolveRedirect('/marked/listing/abc-123')).toEqual({
      location: '/market/listing/abc-123', status: 301,
    });
  });

  it('matches more-specific prefix first', () => {
    expect(resolveRedirect('/marked/oppdrag/abc')).toEqual({
      location: '/market/commissions/abc', status: 301,
    });
  });

  it('does NOT match a longer word that shares the prefix', () => {
    expect(resolveRedirect('/markedet')).toBeNull();
  });

  it('does NOT rewrite a mid-path segment (the prosjekt bug)', () => {
    expect(resolveRedirect('/market/commissions/abc/prosjekt')).toBeNull();
  });

  it('returns null when no redirect applies', () => {
    expect(resolveRedirect('/studio')).toBeNull();
    expect(resolveRedirect('/oppskrifter')).toBeNull();
    expect(resolveRedirect('/')).toBeNull();
  });

  it('redirects English-aliased patterns/projects to Norwegian dirs', () => {
    expect(resolveRedirect('/patterns')).toEqual({ location: '/oppskrifter', status: 308 });
    expect(resolveRedirect('/projects/heart-pattern')).toEqual({
      location: '/prosjekter/heart-pattern', status: 308,
    });
    expect(resolveRedirect('/about')).toEqual({ location: '/om', status: 308 });
  });

  it('redirects studio sub-routes', () => {
    expect(resolveRedirect('/strikkestua/garn')).toEqual({
      location: '/studio/yarn', status: 301,
    });
    expect(resolveRedirect('/strikkestua/mine-oppskrifter/123')).toEqual({
      location: '/studio/my-patterns/123', status: 301,
    });
  });

  it('redirects admin sub-routes', () => {
    expect(resolveRedirect('/admin/brukere/u-1')).toEqual({
      location: '/admin/users/u-1', status: 301,
    });
  });
});
