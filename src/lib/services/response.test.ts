import { describe, it, expect, vi } from 'vitest';
import { toResponse } from './response';

describe('toResponse', () => {
  it('maps unauthorized to 401', async () => {
    const res = toResponse({ ok: false, code: 'unauthorized', message: 'no auth' });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('no auth');
  });

  it('maps forbidden to 403', () => {
    expect(toResponse({ ok: false, code: 'forbidden', message: 'x' }).status).toBe(403);
  });

  it('maps not_found to 404', () => {
    expect(toResponse({ ok: false, code: 'not_found', message: 'x' }).status).toBe(404);
  });

  it('maps bad_input to 400', () => {
    expect(toResponse({ ok: false, code: 'bad_input', message: 'x' }).status).toBe(400);
  });

  it('maps conflict to 409', () => {
    expect(toResponse({ ok: false, code: 'conflict', message: 'x' }).status).toBe(409);
  });

  it('maps server_error to 500', () => {
    expect(toResponse({ ok: false, code: 'server_error', message: 'x' }).status).toBe(500);
  });

  it('returns JSON ok payload when data is present', async () => {
    const res = toResponse({ ok: true, data: { foo: 'bar' } });
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ foo: 'bar' });
  });

  it('returns { ok: true } when data is missing', async () => {
    // ts-expect-error: ServiceResult requires `data` but the fallback path is exercised in routes
    const res = toResponse({ ok: true } as any);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('uses the redirect callback when data.redirect is set', () => {
    const redirect = vi.fn((url: string, status?: number) => new Response('', { status: status ?? 302, headers: { Location: url } }));
    const res = toResponse({ ok: true, data: { redirect: '/destination' } }, redirect);
    expect(redirect).toHaveBeenCalledWith('/destination', 303);
    expect(res.headers.get('Location')).toBe('/destination');
  });

  it('falls back to JSON when redirect callback is missing', async () => {
    const res = toResponse({ ok: true, data: { redirect: '/x' } });
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ redirect: '/x' });
  });

  const redir = () => vi.fn((url: string, status?: number) =>
    new Response('', { status: status ?? 302, headers: { Location: url } }));

  it('appends ?saved=1 to a success redirect when opts.saved is set', () => {
    const r = redir();
    toResponse({ ok: true, data: { redirect: '/studio/yarn/1' } }, r, { saved: true });
    expect(r).toHaveBeenCalledWith('/studio/yarn/1?saved=1', 303);
  });

  it('uses & when the redirect already has a query string', () => {
    const r = redir();
    toResponse({ ok: true, data: { redirect: '/x?tab=a' } }, r, { saved: true });
    expect(r).toHaveBeenCalledWith('/x?tab=a&saved=1', 303);
  });

  it('on failure with errorRedirect, redirects back with the message in ?error=', () => {
    const r = redir();
    const res = toResponse({ ok: false, code: 'bad_input', message: 'Tittel er påkrevd' }, r, {
      errorRedirect: '/studio/yarn/new',
    });
    expect(r).toHaveBeenCalledWith('/studio/yarn/new?error=Tittel%20er%20p%C3%A5krevd', 303);
    expect(res.headers.get('Location')).toBe('/studio/yarn/new?error=Tittel%20er%20p%C3%A5krevd');
  });

  it('still returns bare text on failure when no errorRedirect is given', async () => {
    const res = toResponse({ ok: false, code: 'bad_input', message: 'x' }, redir());
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('x');
  });
});
