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
  prosjekt: 'project',
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

  // Move the marketplace off of littlesandmeknits.com onto its own domain.
  // /market and /market/* on the main site 301 to strikketorget.no.
  if (LITTLES_HOSTS.includes(host) && (path === '/market' || path.startsWith('/market/'))) {
    return new Response(null, {
      status: 301,
      headers: { Location: `https://strikketorget.no${path}${ctx.url.search}` },
    });
  }

  if (isStrikketorget && path === '/') {
    return ctx.redirect('/market');
  }

  if (path.startsWith('/admin') || path.startsWith('/studio') || path.startsWith('/profile')) {
    const { getCurrentUser } = await import('./lib/auth');
    const user = await getCurrentUser({ request: ctx.request, cookies: ctx.cookies });
    if (!user) return ctx.redirect(`/login?next=${encodeURIComponent(path)}`);
  }

  return next();
});
