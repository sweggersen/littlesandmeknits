import { defineMiddleware } from 'astro:middleware';

// Routes that are *always* served in Norwegian regardless of the user's
// language preference: the studio itself (locale-neutral), the API, the
// public share pages, and a small set of operational paths. Every other
// path is candidate for the language redirect.
const NEUTRAL_PREFIXES = [
  '/studio',
  '/api',
  '/admin',
  '/dev',
  '/p/',
  '/sw.js',
  '/manifest.json',
  '/favicon',
  '/_astro',
  '/_image',
];

export const onRequest = defineMiddleware(async (ctx, next) => {
  const url = ctx.url;
  const path = url.pathname;

  // Guard all /admin pages — individual pages still perform role checks.
  if (path.startsWith('/admin')) {
    const { getCurrentUser } = await import('./lib/auth');
    const user = await getCurrentUser({ request: ctx.request, cookies: ctx.cookies });
    if (!user) return ctx.redirect('/logg-inn');
  }

  // Skip neutral / asset routes — let them pass straight through.
  for (const prefix of NEUTRAL_PREFIXES) {
    if (path.startsWith(prefix)) return next();
  }

  // The cookie is set by /api/profile/update when the user saves their
  // profile. No cookie → no preference → no redirect.
  const pref = ctx.cookies.get('lm-lang')?.value;
  if (pref !== 'nb' && pref !== 'en') return next();

  const isOnEn = path === '/en' || path.startsWith('/en/');

  if (pref === 'en' && !isOnEn) {
    const target = path === '/' ? '/en' : `/en${path}`;
    return ctx.redirect(target + url.search, 302);
  }
  if (pref === 'nb' && isOnEn) {
    const stripped = path === '/en' ? '/' : path.slice(3);
    return ctx.redirect(stripped + url.search, 302);
  }

  return next();
});
