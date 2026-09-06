#!/usr/bin/env node
/**
 * QA report — capture step. Seeds a full dataset, then drives Playwright through
 * every launch-facing page as a logged-in seller and saves full-page screenshots
 * + a walkthrough video + a manifest. `build.mjs` turns that into a self-contained
 * HTML report. Run via `npm run qa:report`.
 *
 * Assumes local Supabase + the dev server (http://localhost:4321) are up, and
 * that image transforms are enabled (supabase started WITH imgproxy) so the
 * resized thumbnails render. LOCAL ONLY.
 *
 * Env: QA_BASE (default http://localhost:4321), SB_API_URL, SB_SERVICE_ROLE_KEY,
 *      QA_OUT (default ./qa-report).
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'http://localhost:4321';
const OUT = process.env.QA_OUT ?? 'qa-report';
const SB = process.env.SB_API_URL ?? process.env.PUBLIC_SUPABASE_URL;
const KEY = process.env.SB_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !KEY) { console.error('Need SB_API_URL + SB_SERVICE_ROLE_KEY'); process.exit(1); }
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(SB)) { console.error('LOCAL ONLY'); process.exit(1); }

const SHOTS = `${OUT}/shots`, VIDS = `${OUT}/videos`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(VIDS, { recursive: true });

const ELINE = 'eline@test.strikketorget.no';
const exec = async (action, body = {}) => {
  const token = (await (await fetch(`${BASE}/api/dev/test-token`)).json()).token;
  const r = await fetch(`${BASE}/api/dev/test-exec`, {
    method: 'POST', headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  return r.json();
};
const q = async (p) => (await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json();

// 1. Seed the world + Eline's dashboard, and hydrate the sample images.
console.log('seeding…');
await exec('cleanup');
await exec('seed-world');
await exec('seed-profile', { actor: ELINE, user_emails: [ELINE] });
const SAMPLES = ['sage-sweater', 'autumn-cable', 'terracotta-knit', 'brown-wool', 'mustard-knit', 'cream-flatlay', 'colorful-tshirt', 'texture-close', 'hands-knitting', 'grey-yarn-balls'];
for (const n of SAMPLES) {
  const p = `src/assets/img/${n}.jpg`;
  if (!fs.existsSync(p)) continue;
  await fetch(`${SB}/storage/v1/object/projects/_samples/${n}.jpg`, {
    method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'content-type': 'image/jpeg', 'x-upsert': 'true' },
    body: fs.readFileSync(p),
  });
  // warm the resized variants so imgproxy is hot before screenshots
  for (const w of [160, 400, 500, 600, 800]) await fetch(`${SB}/storage/v1/render/image/public/projects/_samples/${n}.jpg?width=${w}&quality=70`);
}

// 2. Resolve detail-page ids.
const elineId = (await q(`profiles?select=id&display_name=eq.Eline%20Berg`))[0]?.id;
const listing = (await q(`listings?select=id&seller_id=eq.${elineId}&status=eq.active&limit=1`))[0];
const proj = (await q(`projects?select=id&title=eq.Marius-genser%20til%20Emma&limit=1`))[0];
const store = (await q(`stores?select=slug&limit=1`))[0];

const PAGES = [
  ['Profil', 'Profil · Oversikt (dashboard)', '/profile', 'Nøkkeltall viser ekte totaler (17 annonser, ikke den gamle avkortede 6-en), ingen feilbanner.'],
  ['Profil', 'Profil · Kjøpte oppskrifter', '/profile/purchases', 'Overskrift "Kjøpte oppskrifter"; EmptyState + feiltilstand; "Start prosjekt" synlig på mobil.'],
  ['Profil', 'Profil · Bibliotek', '/profile/library', 'Kanonisk oppskriftsbibliotek (studio-ruten 301-er hit); relevante omslagsbilder.'],
  ['Profil', 'Profil · Mine butikker', '/profile/stores', 'StatusBadge på butikkstatus; formatDate; typede rader (ikke as any).'],
  ['Profil', 'Profil · Rediger', '/profile/edit', 'Alert-komponent; lagring deaktivert + varsel om profilen ikke lastet (ingen datatap).'],
  ['Profil', 'Profil · Merker', '/profile/badges', 'Divisjon-med-null-vern på fremdriftslinjen.'],
  ['Strikkestua', 'Strikkestua · Hjem', '/studio', 'Feilbanner ved lastefeil; em-dash-fri tekst.'],
  ['Strikkestua', 'Strikkestua · Garnlager', '/studio/yarn', 'Ekte garnbilder; PWA-fane markeres nå (regex-fiks); feiltilstand.'],
  ['Strikkestua', 'Strikkestua · Prosjekter', '/studio/projects', 'ProjectCard med resizede, relevante miniatyrbilder; StatusBadge.'],
  ['Strikkestua', 'Strikkestua · Prosjekt (detalj)', proj ? `/studio/projects/${proj.id}` : '/studio/projects', 'StatusBadge i header; vern mot sletting av hovedbilde; typet commission-join.'],
  ['Strikkestua', 'Strikkestua · Pinner', '/studio/needles', 'NEEDLE_TYPE-etiketter samlet i labels.ts; feiltilstand.'],
  ['Strikkestua', 'Strikkestua · Verktøy', '/studio/tools', 'aria-labels på linjal ±; em-dash-fri tekst.'],
  ['Strikketorget', 'Strikketorget · Brukt', '/market/used', 'Omskrevet undertittel; relevante, lazy-lastede, resizede ListingCard-miniatyrer.'],
  ['Strikketorget', 'Strikketorget · Nytt', '/market/new', 'Feiltilstand ved spørringsfeil; relevante miniatyrer.'],
  ['Strikketorget', 'Strikketorget · Oppdrag', '/market/commissions', 'Feiltilstand ved spørringsfeil; oppdragskort.'],
  ['Strikketorget', 'Strikketorget · Annonse (detalj)', listing ? `/market/listing/${listing.id}` : '/market/used', 'ListingPhotos-galleri dobbeltbinding fikset; relevante bilder.'],
  ['Strikketorget', 'Strikketorget · Butikk', store ? `/market/store/${store.slug}` : '/market/stores', 'Offentlig butikkfront.'],
  ['System', 'Feilside · 404', '/this-does-not-exist-xyz', 'Ny brandet 404 (var bare "Not found").'],
];

// 3. Tour.
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  recordVideo: { dir: VIDS, size: { width: 1280, height: 900 } },
});
await context.addInitScript(() => { try { localStorage.setItem('lm-cookie-consent', '1'); } catch {} });
await context.request.post(`${BASE}/api/dev/test-login`, { data: { email: ELINE } });
const page = await context.newPage();

const manifest = [];
for (const [g, name, path, note] of PAGES) {
  const file = `${String(manifest.length + 1).padStart(2, '0')}.jpg`;
  try {
    const resp = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
    await page.addStyleTag({ content: 'astro-dev-toolbar,#lm-cookie-banner{display:none!important}' }).catch(() => {});
    await page.evaluate(async () => { await new Promise((r) => { window.scrollTo(0, document.body.scrollHeight); setTimeout(r, 400); }); window.scrollTo(0, 0); });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/${file}`, fullPage: true, type: 'jpeg', quality: 72 });
    manifest.push({ g, name, path, note, file, status: resp?.status() ?? 0 });
    console.log(`✓ ${name} (${resp?.status()})`);
  } catch (e) {
    manifest.push({ g, name, path, note, file: null, status: 'ERR', err: String(e).slice(0, 80) });
    console.log(`✗ ${name}: ${String(e).slice(0, 80)}`);
  }
}
await context.close();
await browser.close();

// keep only the newest video
const vids = fs.readdirSync(VIDS).filter((f) => f.endsWith('.webm')).map((f) => ({ f, t: fs.statSync(`${VIDS}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t);
vids.slice(1).forEach((v) => fs.rmSync(`${VIDS}/${v.f}`));
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`\ncaptured ${manifest.filter((m) => m.file).length}/${PAGES.length} pages -> ${OUT}/`);
