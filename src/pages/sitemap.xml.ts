import type { APIRoute } from 'astro';
import { createAdminSupabase } from '../lib/supabase';
import { listingPath } from '../lib/listing-url';
import { env } from '../lib/env';

const SITE = 'https://littlesandmeknits.com';

// Static routes that should always be indexed. We list them explicitly
// rather than scanning the filesystem so that auth-only / admin / dev
// surfaces are excluded by design, matching what robots.txt blocks.
const STATIC_ROUTES = [
  '/',
  '/om',
  '/oppskrifter',
  '/prosjekter',
  '/login',
  '/terms',
  '/privacy',
  '/hjelp',
  '/hjelp/selge',
  '/hjelp/kjope',
  '/hjelp/trygg-betaling',
  '/market',
  '/market/used',
  '/market/new',
  '/market/commissions',
  '/market/stores',
];

function urlEntry(loc: string, lastmod?: string, changefreq?: string, priority?: string) {
  return `  <url>
    <loc>${SITE}${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}${changefreq ? `\n    <changefreq>${changefreq}</changefreq>` : ''}${priority ? `\n    <priority>${priority}</priority>` : ''}
  </url>`;
}

export const GET: APIRoute = async () => {
  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

  // Active listings — the bulk of the crawlable surface. We cap to a
  // reasonable number; if we cross 30k listings we can paginate via
  // /sitemap-listings-N.xml later.
  const { data: listings } = await admin
    .from('listings')
    .select('id, title, updated_at')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(20000);

  // Active stores — small but valuable for brand-name queries.
  // stores has no updated_at column; use created_at as the lastmod hint.
  const { data: stores } = await admin
    .from('stores')
    .select('slug, created_at')
    .eq('status', 'active');

  const entries: string[] = [];

  for (const path of STATIC_ROUTES) {
    entries.push(urlEntry(path, undefined, 'daily', path === '/market' ? '1.0' : '0.7'));
  }

  // Category landing pages — high SEO value for queries like 'brukt
  // strikket genser', 'nytt babyteppe', etc. 9 categories × 2 kinds.
  const KINDS = ['used', 'new'];
  const CATEGORIES = ['genser', 'cardigan', 'lue', 'votter', 'sokker', 'teppe', 'kjole', 'bukser', 'annet'];
  for (const k of KINDS) {
    for (const c of CATEGORIES) {
      entries.push(urlEntry(`/market/${k}/${c}`, undefined, 'daily', '0.8'));
    }
  }
  for (const l of listings ?? []) {
    entries.push(urlEntry(listingPath(l), l.updated_at ?? undefined, 'weekly', '0.6'));
  }
  for (const s of stores ?? []) {
    if (!s.slug) continue;
    entries.push(urlEntry(`/market/store/${s.slug}`, s.created_at ?? undefined, 'weekly', '0.5'));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // Cache for 1 hour at the edge — sitemaps don't need to be live.
      'cache-control': 'public, max-age=3600, s-maxage=3600',
    },
  });
};
