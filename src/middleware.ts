import { defineMiddleware } from 'astro:middleware';

const STRIKKETORGET_HOSTS = ['strikketorget.no', 'www.strikketorget.no'];
const LITTLES_HOSTS = ['littlesandmeknits.com', 'www.littlesandmeknits.com'];

// Legacy Norwegian path segments → English. Applied left-to-right as URL segments.
// Kept here (not in routing) so old notification URLs / bookmarks 301 to the
// new English routes.
const LEGACY_SEGMENTS: Record<string, string> = {
  marked: 'market',
  brukt: 'used',
  favoritter: 'favorites',
  'mine-kjop': 'my-purchases',
  nytt: 'new',
  oppdrag: 'commissions',
  // 'prosjekt' (singular) is intentionally not remapped - the new
  // commission project view lives at /market/commissions/<id>/prosjekt
  // and a blanket segment rewrite would break it.
  meldinger: 'messages',
  selger: 'seller',
  statistikk: 'stats',
  profil: 'profile',
  bibliotek: 'library',
  'logg-inn': 'login',
  varsler: 'notifications',
  personvern: 'privacy',
  vilkar: 'terms',
  // NOTE: the patterns + projects + about pages still live under their Norwegian
  // route dirs (src/pages/oppskrifter, src/pages/prosjekter). We map the
  // English-named paths back to Norwegian below so internal /patterns and
  // /projects links work.
  garn: 'yarn',
  laer: 'learn',
  'mine-oppskrifter': 'my-patterns',
  pinner: 'needles',
  verktoy: 'tools',
  brukere: 'users',
  logg: 'log',
  moderatorer: 'moderators',
  moderering: 'moderation',
  rapporter: 'reports',
  tvister: 'disputes',
  utbetalinger: 'payouts',
};

function rewriteLegacyPath(path: string): string | null {
  const segments = path.split('/');
  let changed = false;
  const rewritten = segments.map((seg) => {
    if (seg in LEGACY_SEGMENTS) {
      changed = true;
      return LEGACY_SEGMENTS[seg];
    }
    return seg;
  });
  return changed ? rewritten.join('/') : null;
}

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

  // 301 legacy Norwegian paths to the new English routes.
  const rewritten = rewriteLegacyPath(path);
  if (rewritten) {
    const target = rewritten + ctx.url.search;
    return new Response(null, { status: 301, headers: { Location: target } });
  }

  // English-named aliases for routes that physically live under Norwegian
  // dirs. Top-level only — /en/patterns is its own English-locale page.
  if (path === '/patterns' || path.startsWith('/patterns/')) {
    return ctx.redirect(path.replace(/^\/patterns/, '/oppskrifter') + ctx.url.search, 308);
  }
  if (path === '/projects' || path.startsWith('/projects/')) {
    return ctx.redirect(path.replace(/^\/projects/, '/prosjekter') + ctx.url.search, 308);
  }
  if (path === '/about') {
    return ctx.redirect('/om' + ctx.url.search, 308);
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

  if (path.startsWith('/admin') || path.startsWith('/studio') || path.startsWith('/profile')) {
    const { getCurrentUser } = await import('./lib/auth');
    const user = await getCurrentUser({ request: ctx.request, cookies: ctx.cookies });
    if (!user) return ctx.redirect(`/login?next=${encodeURIComponent(path)}`);
  }

  return next();
});
