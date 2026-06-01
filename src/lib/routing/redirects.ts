// Legacy → canonical URL redirects. ONE source of truth.
//
// Each entry matches a path PREFIX (always starting with '/'), redirects
// 301 to the corresponding new prefix, and preserves the rest of the path
// and the query string.
//
// Rules:
//   - `from` must be a full path segment boundary ('/foo' matches '/foo'
//     and '/foo/...' but NOT '/foobar'). Mid-path segments are NOT
//     rewritten — this avoids the class of bug where a segment named
//     'prosjekt' anywhere in the URL silently mangled the route.
//   - Entries are evaluated in order; the first match wins. Put longer
//     prefixes first so e.g. '/marked/oppdrag' is rewritten before
//     '/marked'.
//   - When considering removing an entry, check Cloudflare logs for hits
//     in the past 30 days. Zero hits → safe to drop.

export interface RouteRedirect {
  from: string;   // '/marked'  — leading slash, no trailing slash
  to: string;     // '/market'  — leading slash, no trailing slash
  status: 301 | 308;
}

// Order matters. Longer/more-specific prefixes first.
export const ROUTE_REDIRECTS: ReadonlyArray<RouteRedirect> = [
  // Strikketorget: old Norwegian top-level → new English (one-shot
  // rename in 2025, kept for bookmark continuity)
  { from: '/marked/oppdrag',       to: '/market/commissions',  status: 301 },
  { from: '/marked/brukt',         to: '/market/used',         status: 301 },
  { from: '/marked/nytt',          to: '/market/new',          status: 301 },
  { from: '/marked/favoritter',    to: '/market/favorites',    status: 301 },
  { from: '/marked/mine-kjop',     to: '/market/my-purchases', status: 301 },
  { from: '/marked/meldinger',     to: '/market/messages',     status: 301 },
  { from: '/marked/selger',        to: '/market/seller',       status: 301 },
  { from: '/marked/statistikk',    to: '/market/stats',        status: 301 },
  { from: '/marked',               to: '/market',              status: 301 },

  // Studio: old NO → new EN top-level
  { from: '/strikkestua/garn',          to: '/studio/yarn',         status: 301 },
  { from: '/strikkestua/pinner',        to: '/studio/needles',      status: 301 },
  { from: '/strikkestua/verktoy',       to: '/studio/tools',        status: 301 },
  { from: '/strikkestua/bibliotek',     to: '/studio/library',      status: 301 },
  { from: '/strikkestua/mine-oppskrifter', to: '/studio/my-patterns', status: 301 },
  { from: '/strikkestua/laer',          to: '/studio/learn',        status: 301 },
  { from: '/strikkestua',               to: '/studio',              status: 301 },

  // Shared auth/account
  { from: '/profil',         to: '/profile',         status: 301 },
  { from: '/logg-inn',       to: '/login',           status: 301 },
  { from: '/varsler',        to: '/notifications',   status: 301 },
  { from: '/personvern',     to: '/privacy',         status: 301 },
  { from: '/vilkar',         to: '/terms',           status: 301 },

  // Admin
  { from: '/admin/brukere',     to: '/admin/users',        status: 301 },
  { from: '/admin/moderatorer', to: '/admin/moderators',   status: 301 },
  { from: '/admin/moderering',  to: '/admin/moderation',   status: 301 },
  { from: '/admin/rapporter',   to: '/admin/reports',      status: 301 },
  { from: '/admin/tvister',     to: '/admin/disputes',     status: 301 },
  { from: '/admin/utbetalinger', to: '/admin/payouts',     status: 301 },
  { from: '/admin/logg',        to: '/admin/log',          status: 301 },

  // Pages that still PHYSICALLY live in Norwegian dirs. The English
  // names are aliases that 308 to the Norwegian originals so internal
  // English-named links resolve. Move these to '/patterns', etc. once
  // we rename the pages directory.
  { from: '/patterns',  to: '/oppskrifter', status: 308 },
  { from: '/projects',  to: '/prosjekter',  status: 308 },
  { from: '/about',     to: '/om',          status: 308 },
];

/**
 * Resolve a redirect for the given path, if any. Matches at segment
 * boundaries only — '/marked' matches '/marked' and '/marked/...' but
 * not '/markedet'. Returns `null` when no redirect applies.
 */
export function resolveRedirect(path: string): { location: string; status: 301 | 308 } | null {
  for (const r of ROUTE_REDIRECTS) {
    if (path === r.from) {
      return { location: r.to, status: r.status };
    }
    if (path.startsWith(r.from + '/')) {
      return { location: r.to + path.slice(r.from.length), status: r.status };
    }
  }
  return null;
}
