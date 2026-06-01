import { defineMiddleware } from 'astro:middleware';
import { resolveRedirect } from './lib/routing/redirects';

const STRIKKETORGET_HOSTS = ['strikketorget.no', 'www.strikketorget.no'];
const LITTLES_HOSTS = ['littlesandmeknits.com', 'www.littlesandmeknits.com'];

export const onRequest = defineMiddleware(async (ctx, next) => {
  const host = ctx.url.hostname;
  const path = ctx.url.pathname;

  const isStrikketorget = STRIKKETORGET_HOSTS.includes(host)
    || ctx.url.searchParams.get('strikketorget') === '1';
  ctx.locals.isStrikketorget = isStrikketorget;

  // Track whether the visitor is currently *inside* the Strikketorget
  // section. /market and /inbox set the marker; /profile and similar
  // "shared" routes preserve it; visiting the main site clears it.
  const cookieMarker = ctx.cookies.get('st_session')?.value === '1';
  let inMarketSession = cookieMarker;
  if (path === '/market' || path.startsWith('/market/') || path === '/inbox' || path.startsWith('/inbox?')) {
    inMarketSession = true;
    if (!cookieMarker) ctx.cookies.set('st_session', '1', { path: '/', sameSite: 'lax', httpOnly: false });
  } else if (
    path === '/' || path.startsWith('/oppskrifter') || path.startsWith('/prosjekter')
    || path.startsWith('/p/') || path === '/about' || path.startsWith('/about/')
    || path.startsWith('/studio') || path === '/login' || path === '/signup'
  ) {
    inMarketSession = false;
    if (cookieMarker) ctx.cookies.delete('st_session', { path: '/' });
  }
  ctx.locals.inMarketSession = inMarketSession;

  // Track the section the user came from so the nav can show
  // "Tilbake til Strikketorget" only when they actually just came from
  // there (not just because they visited it last week). Cookie holds the
  // section of the *previous* request; we read it before overwriting with
  // the current section.
  const prevSection = ctx.cookies.get('prev_section')?.value as
    | 'market' | 'studio' | 'lmk' | undefined;
  ctx.locals.prevSection = prevSection ?? null;

  const curSection: 'market' | 'studio' | 'lmk' | null = (() => {
    if (path === '/market' || path.startsWith('/market/')) return 'market';
    if (path === '/studio' || path.startsWith('/studio/')) return 'studio';
    // Public LMK content. Exclude auth surfaces and shared screens that
    // don't carry section identity.
    if (
      path === '/' || path.startsWith('/oppskrifter') || path.startsWith('/prosjekter')
      || path.startsWith('/p/') || path === '/om' || path.startsWith('/om/')
      || path === '/about' || path.startsWith('/about/')
    ) return 'lmk';
    return null;
  })();
  if (curSection) {
    ctx.cookies.set('prev_section', curSection, {
      path: '/', sameSite: 'lax', httpOnly: false,
    });
  }

  // Centralised legacy → canonical redirects. Table lives in
  // src/lib/routing/redirects.ts. Matches segment boundaries only —
  // no mid-path rewrites.
  const redirect = resolveRedirect(path);
  if (redirect) {
    return new Response(null, {
      status: redirect.status,
      headers: { Location: redirect.location + ctx.url.search },
    });
  }

  // All authenticated routes live on strikketorget.no exclusively. This
  // avoids the cross-origin re-login problem (cookies set on one host
  // don't carry to the other). Public marketing pages stay on LMK.
  const AUTH_ONLY_PREFIXES = [
    '/market',
    '/studio',
    '/onboarding',
    '/inbox',
    '/profile',
    '/innstillinger',
    '/admin',
    '/auth/',
    '/login',
    '/signup',
    '/reset-password',
  ];
  if (
    LITTLES_HOSTS.includes(host)
    && AUTH_ONLY_PREFIXES.some((p) => path === p.replace(/\/$/, '') || path === p || path.startsWith(p))
  ) {
    return new Response(null, {
      status: 301,
      headers: { Location: `https://strikketorget.no${path}${ctx.url.search}` },
    });
  }

  // On strikketorget.no, serve the marketplace home at the bare domain
  // instead of redirecting to /market. (Sub-routes still live at /market/...)
  if (isStrikketorget && path === '/') {
    return ctx.rewrite('/market');
  }

  // Auth load + gate, in one pass. We populate ctx.locals.user for every
  // route so downstream pages can render personalised content without
  // making another auth call. For gated prefixes we redirect to login
  // when the user is missing.
  const GATED_PREFIXES = ['/admin', '/studio', '/profile', '/inbox', '/innstillinger', '/onboarding'];
  const isGated = GATED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
  if (isGated || !ctx.url.searchParams.has('skip_auth_load')) {
    const { getCurrentUser } = await import('./lib/auth');
    const user = await getCurrentUser({ request: ctx.request, cookies: ctx.cookies });
    ctx.locals.user = user;
    if (isGated && !user) {
      const next = path + (ctx.url.search ?? '');
      return ctx.redirect(`/login?next=${encodeURIComponent(next)}`);
    }
  }

  return next();
});
