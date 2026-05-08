#!/usr/bin/env npx tsx
/**
 * Strikketorget — Marketplace seed script
 *
 * Creates test personas, listings across all categories, conversations
 * with realistic Norwegian messages, and marks some items as sold.
 *
 * Usage:
 *   npx tsx scripts/marketplace-seed.ts
 *
 * Env vars (reads from .env.local + .dev.vars, or set directly):
 *   PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Env loading ──────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  Object.entries(process.env).forEach(([k, v]) => { if (v) result[k] = v; });
  for (const file of ['.env.local', '.env', '.dev.vars']) {
    try {
      for (const line of readFileSync(resolve(process.cwd(), file), 'utf-8').split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"#]*)"?\s*$/);
        if (m) result[m[1].trim()] = m[2].trim();
      }
    } catch {}
  }
  return result;
}

const env = loadEnv();
const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('\n  Missing env vars. Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  console.error('  Either in .env.local / .dev.vars or as environment variables.\n');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Personas ─────────────────────────────────────────────────

const PASSWORD = 'strikke-test-2026';
const EMAIL_DOMAIN = '@test.strikketorget.no';

interface Persona {
  slug: string;
  email: string;
  displayName: string;
  location: string;
  role: string;
  id?: string;
}

const PERSONAS: Persona[] = [
  { slug: 'eline', email: `eline${EMAIL_DOMAIN}`, displayName: 'Eline', location: 'Bergen', role: 'Selger pre-loved' },
  { slug: 'maja', email: `maja${EMAIL_DOMAIN}`, displayName: 'Maja', location: 'Oslo', role: 'Ferdigstrikket-selger' },
  { slug: 'ingrid', email: `ingrid${EMAIL_DOMAIN}`, displayName: 'Ingrid', location: 'Trondheim', role: 'Kjøper og selger' },
  { slug: 'sigrid', email: `sigrid${EMAIL_DOMAIN}`, displayName: 'Sigrid', location: 'Stavanger', role: 'Babyklær-spesialist' },
  { slug: 'hanne', email: `hanne${EMAIL_DOMAIN}`, displayName: 'Hanne', location: 'Tromsø', role: 'Vinterplagg-selger' },
  { slug: 'liv', email: `liv${EMAIL_DOMAIN}`, displayName: 'Liv', location: 'Drammen', role: 'Ny bruker, kjøper' },
  { slug: 'astrid', email: `astrid${EMAIL_DOMAIN}`, displayName: 'Astrid', location: 'Kristiansand', role: 'Blanding kjøp/salg' },
  { slug: 'tuva', email: `tuva${EMAIL_DOMAIN}`, displayName: 'Tuva', location: 'Fredrikstad', role: 'Storselger' },
];

// ─── Listings ─────────────────────────────────────────────────

interface ListingDef {
  sellerSlug: string;
  kind: 'pre_loved' | 'ready_made';
  title: string;
  description: string;
  price_nok: number;
  size_label: string;
  size_age_months_min?: number;
  size_age_months_max?: number;
  category: string;
  condition?: string;
  colorway?: string;
  pattern_external_title?: string;
  location: string;
  shipping_info: string;
  status: 'draft' | 'active' | 'sold';
}

const LISTINGS: ListingDef[] = [
  // ── Eline (Bergen) — pre-loved ──
  { sellerSlug: 'eline', kind: 'pre_loved', title: 'Sondre cardigan str. 86, dustyrosa', description: 'Strikket i Sandnes Garn Alpakka. Brukt én sesong, vasket forsiktig. Nydelig farge som passer til det meste.', price_nok: 280, size_label: '86', size_age_months_min: 12, size_age_months_max: 18, category: 'cardigan', condition: 'lite_brukt', colorway: 'Dustyrosa', pattern_external_title: 'Sondre, Weggersen Design', location: 'Bergen', shipping_info: 'Sender med Posten Småpakke (ca 80 kr)', status: 'active' },
  { sellerSlug: 'eline', kind: 'pre_loved', title: 'Wilma lue str. 1–2 år', description: 'Myk merinolue, perfekt for høst. Vasket mange ganger men holder seg fint.', price_nok: 90, size_label: '1–2 år', size_age_months_min: 12, size_age_months_max: 24, category: 'lue', condition: 'brukt', colorway: 'Mellomgrå', location: 'Bergen', shipping_info: 'Sender med Posten, kan hentes Bryggen', status: 'sold' },
  { sellerSlug: 'eline', kind: 'pre_loved', title: 'Ribbestrikket bukse str. 80', description: 'Strikket i Drops Baby Merino. Litt nuppete men fullt brukbar.', price_nok: 120, size_label: '80', size_age_months_min: 9, size_age_months_max: 12, category: 'bukser', condition: 'brukt', colorway: 'Naturhvit', location: 'Bergen', shipping_info: 'Sender med Posten', status: 'active' },
  { sellerSlug: 'eline', kind: 'pre_loved', title: 'Babysokker str. 0–3 mnd (3 par)', description: 'Tre par babysokker i ulike farger. Aldri brukt, bare vasket.', price_nok: 60, size_label: '0–3 mnd', size_age_months_min: 0, size_age_months_max: 3, category: 'sokker', condition: 'som_ny', colorway: 'Rosa, hvit, lyseblå', location: 'Bergen', shipping_info: 'Kan sendes som brev (20 kr)', status: 'active' },

  // ── Maja (Oslo) — ready-made ──
  { sellerSlug: 'maja', kind: 'ready_made', title: 'Handstrikket Solskinn-genser str. 98', description: 'Strikket på bestilling i Sandnes Garn Sunday. Kan strikkes i andre farger — ta kontakt!', price_nok: 890, size_label: '98', size_age_months_min: 24, size_age_months_max: 36, category: 'genser', colorway: 'Solsikkegul', pattern_external_title: 'Solskinn, Weggersen Design', location: 'Oslo', shipping_info: 'Sender med Posten, henting Grünerløkka', status: 'active' },
  { sellerSlug: 'maja', kind: 'ready_made', title: 'Sjøgras-teppe i alpakka', description: 'Stort babyteppe (80×100 cm) i Sandnes Garn Alpakka. Vakkert som gave. Tar ca 3 uker å strikke.', price_nok: 1200, size_label: 'One size', category: 'teppe', colorway: 'Sjøgrønn', pattern_external_title: 'Sjøgras, Weggersen Design', location: 'Oslo', shipping_info: 'Sender som pakke med sporing', status: 'active' },
  { sellerSlug: 'maja', kind: 'ready_made', title: 'Skog cardigan str. 92', description: 'Fargestrikkdesign med granmotiv. Strikket i Rauma Finull. Unik og håndlaget.', price_nok: 950, size_label: '92', size_age_months_min: 18, size_age_months_max: 24, category: 'cardigan', colorway: 'Grønn/naturhvit', pattern_external_title: 'Skog, Weggersen Design', location: 'Oslo', shipping_info: 'Henting Oslo sentrum eller Posten', status: 'active' },
  { sellerSlug: 'maja', kind: 'ready_made', title: 'Vottesett med tommel str. 2–4 år', description: 'Varme votter i tjukk ull. Strikket dobbelt for ekstra varme. Tåler mye lek!', price_nok: 320, size_label: '2–4 år', size_age_months_min: 24, size_age_months_max: 48, category: 'votter', colorway: 'Terrakotta', location: 'Oslo', shipping_info: 'Sender som brev eller Småpakke', status: 'active' },

  // ── Sigrid (Stavanger) — baby pre-loved ──
  { sellerSlug: 'sigrid', kind: 'pre_loved', title: 'Nydelig dåpskjole str. 68', description: 'Hvit blondestrikk i merinoull. Brukt til dåp, deretter oppbevart i silkepapir. Praktfull.', price_nok: 450, size_label: '68', size_age_months_min: 3, size_age_months_max: 6, category: 'kjole', condition: 'som_ny', colorway: 'Hvit', location: 'Stavanger', shipping_info: 'Sender forsiktig pakket med Posten', status: 'active' },
  { sellerSlug: 'sigrid', kind: 'pre_loved', title: 'Strikket babydrakt str. 62', description: 'Heldress i myk bomullsblanding. Brukt noen uker, ingen flekker.', price_nok: 180, size_label: '62', size_age_months_min: 0, size_age_months_max: 3, category: 'annet', condition: 'lite_brukt', colorway: 'Lys gul', location: 'Stavanger', shipping_info: 'Sender med Posten', status: 'active' },
  { sellerSlug: 'sigrid', kind: 'pre_loved', title: 'Babyvotter uten tommel str. 0–6 mnd', description: 'Myke votter i merino. Perfekt for nyfødt.', price_nok: 50, size_label: '0–6 mnd', size_age_months_min: 0, size_age_months_max: 6, category: 'votter', condition: 'som_ny', colorway: 'Hvit', location: 'Stavanger', shipping_info: 'Kan sendes som brev', status: 'active' },

  // ── Hanne (Tromsø) — ready-made winter ──
  { sellerSlug: 'hanne', kind: 'ready_made', title: 'Nordnorsk ragglue i reinsdyrull', description: 'Tykk og varm lue med øreklaffer. Strikket i lokalprodusert reinsdyrull fra Troms. Holder varmen ned til -30.', price_nok: 420, size_label: '3–6 år', size_age_months_min: 36, size_age_months_max: 72, category: 'lue', colorway: 'Naturbrun/hvit', location: 'Tromsø', shipping_info: 'Sender med Posten', status: 'active' },
  { sellerSlug: 'hanne', kind: 'ready_made', title: 'Vindtette strikkeluffer str. 4–6 år', description: 'Dobbelt strikket med vindtett fôr. Perfekt for skilek og akebakken.', price_nok: 380, size_label: '4–6 år', size_age_months_min: 48, size_age_months_max: 72, category: 'votter', colorway: 'Mørk blå/hvit', location: 'Tromsø', shipping_info: 'Sender med Posten Småpakke', status: 'active' },
  { sellerSlug: 'hanne', kind: 'ready_made', title: 'Ulldress med raglanfelling str. 80', description: 'Helstrikket dress i tykt ullgarn. Knapper i front for enkel av/påkledning. Varm og myk.', price_nok: 780, size_label: '80', size_age_months_min: 9, size_age_months_max: 12, category: 'annet', colorway: 'Lys grå melert', location: 'Tromsø', shipping_info: 'Sender som pakke med sporing', status: 'draft' },

  // ── Ingrid (Trondheim) — occasional seller ──
  { sellerSlug: 'ingrid', kind: 'pre_loved', title: 'Strikket genser str. 104', description: 'Enkel raglanfelling i Drops Nepal. Godt brukt men solid.', price_nok: 150, size_label: '104', size_age_months_min: 36, size_age_months_max: 48, category: 'genser', condition: 'brukt', colorway: 'Jeansblå', location: 'Trondheim', shipping_info: 'Henting Solsiden eller Posten', status: 'active' },
  { sellerSlug: 'ingrid', kind: 'pre_loved', title: 'Strikket ringesnurr/sokker str. 2 år', description: 'Hjemmestrikket i restegarn. Litt slitte under men fungerer fint til innebruk.', price_nok: 40, size_label: '2 år', size_age_months_min: 18, size_age_months_max: 24, category: 'sokker', condition: 'slitt', colorway: 'Flerfarget', location: 'Trondheim', shipping_info: 'Kan sendes som brev', status: 'active' },

  // ── Astrid (Kristiansand) — mix ──
  { sellerSlug: 'astrid', kind: 'pre_loved', title: 'Ulljakke med knapper str. 92', description: 'Strikket i Dale Baby Ull. Fin stand, noen småflekker som sikkert går ut i vask.', price_nok: 200, size_label: '92', size_age_months_min: 18, size_age_months_max: 24, category: 'cardigan', condition: 'lite_brukt', colorway: 'Rød', location: 'Kristiansand', shipping_info: 'Sender med Posten', status: 'active' },
  { sellerSlug: 'astrid', kind: 'ready_made', title: 'Heklet sommerkjole str. 86', description: 'Lettstrikket i bomull. Perfekt til sommeren. Kan strikkes i ønsket farge.', price_nok: 550, size_label: '86', size_age_months_min: 12, size_age_months_max: 18, category: 'kjole', colorway: 'Hvit med rosa detaljer', location: 'Kristiansand', shipping_info: 'Sender med Posten, hentes Markens', status: 'active' },

  // ── Tuva (Fredrikstad) — power seller ──
  { sellerSlug: 'tuva', kind: 'pre_loved', title: 'Marius-genser str. 110', description: 'Klassisk Marius i rød, hvit og blå. Strikket av bestemor. Brukt én vinter.', price_nok: 350, size_label: '110', size_age_months_min: 48, size_age_months_max: 60, category: 'genser', condition: 'lite_brukt', colorway: 'Rød/hvit/blå', pattern_external_title: 'Marius (klassisk)', location: 'Fredrikstad', shipping_info: 'Sender med Posten eller henting', status: 'active' },
  { sellerSlug: 'tuva', kind: 'pre_loved', title: 'Strikket lue og skjerf sett str. 3–5 år', description: 'Matchende sett i tjukk ull. Varmt og mykt, lite brukt.', price_nok: 160, size_label: '3–5 år', size_age_months_min: 36, size_age_months_max: 60, category: 'lue', condition: 'lite_brukt', colorway: 'Mosegrønn', location: 'Fredrikstad', shipping_info: 'Sender med Posten Småpakke', status: 'active' },
  { sellerSlug: 'tuva', kind: 'pre_loved', title: 'Babyteppe i bomull 70×90', description: 'Strikket i Drops Safran. Perfekt til vogn. Maskinvaskbart.', price_nok: 180, size_label: 'One size', category: 'teppe', condition: 'lite_brukt', colorway: 'Hvit', location: 'Fredrikstad', shipping_info: 'Sender som pakke', status: 'active' },
  { sellerSlug: 'tuva', kind: 'pre_loved', title: 'Strikket cardigan str. 74', description: 'Enkel rillejakke i Sandnes Garn Babyull. Fin til nyfødt.', price_nok: 110, size_label: '74', size_age_months_min: 6, size_age_months_max: 9, category: 'cardigan', condition: 'brukt', colorway: 'Lys rosa', location: 'Fredrikstad', shipping_info: 'Sender med Posten', status: 'active' },
  { sellerSlug: 'tuva', kind: 'ready_made', title: 'Handstrikket Morgen-sett str. 86', description: 'Genser + bukse i Sandnes Garn Peer Gynt. Herlig hverdagssett.', price_nok: 1100, size_label: '86', size_age_months_min: 12, size_age_months_max: 18, category: 'genser', colorway: 'Havregryn', pattern_external_title: 'Morgen-sett, Weggersen Design', location: 'Fredrikstad', shipping_info: 'Sender med Posten', status: 'active' },
  { sellerSlug: 'tuva', kind: 'pre_loved', title: 'Ullsokker str. 4–6 år (2 par)', description: 'To par raggsokker. Litt nuppete men veldig varme.', price_nok: 70, size_label: '4–6 år', size_age_months_min: 48, size_age_months_max: 72, category: 'sokker', condition: 'brukt', colorway: 'Grå + brun', location: 'Fredrikstad', shipping_info: 'Sendes som brev', status: 'active' },
];

// ─── Conversations ────────────────────────────────────────────

interface ConversationDef {
  buyerSlug: string;
  listingTitle: string;
  messages: { senderRole: 'buyer' | 'seller'; body: string }[];
}

const CONVERSATIONS: ConversationDef[] = [
  {
    buyerSlug: 'liv', listingTitle: 'Sondre cardigan str. 86, dustyrosa',
    messages: [
      { senderRole: 'buyer', body: 'Hei! Er denne fortsatt tilgjengelig?' },
      { senderRole: 'seller', body: 'Hei Liv! Ja, den er det. Nydelig cardigan, perfekt for våren.' },
      { senderRole: 'buyer', body: 'Flott! Kan du sende den til Drammen?' },
      { senderRole: 'seller', body: 'Selvfølgelig! Det blir ca 80 kr for Posten Småpakke. Skal jeg sende i morgen?' },
      { senderRole: 'buyer', body: 'Ja takk! Kan du sende Vipps-info?' },
      { senderRole: 'seller', body: 'Sender deg Vipps-nummer på melding her: 98765432 (Eline). 280 + 80 = 360 kr totalt.' },
    ],
  },
  {
    buyerSlug: 'ingrid', listingTitle: 'Wilma lue str. 1–2 år',
    messages: [
      { senderRole: 'buyer', body: 'Hei, kan denne hentes i Bergen?' },
      { senderRole: 'seller', body: 'Ja, jeg kan møtes ved Bryggen eller Bystasjonen. Når passer det?' },
      { senderRole: 'buyer', body: 'Jeg er i Bergen neste helg! Lørdag formiddag?' },
      { senderRole: 'seller', body: 'Perfekt! Vi sier Bystasjonen kl 11? Tar Vipps.' },
      { senderRole: 'buyer', body: 'Supert, ses da!' },
    ],
  },
  {
    buyerSlug: 'liv', listingTitle: 'Handstrikket Solskinn-genser str. 98',
    messages: [
      { senderRole: 'buyer', body: 'Så nydelig genser! Kan du strikke den i str. 92 i stedet?' },
      { senderRole: 'seller', body: 'Hei! Ja, det kan jeg. Samme pris, tar ca 2 uker. Hvilken farge?' },
      { senderRole: 'buyer', body: 'Solsikkegul er perfekt! Bestiller gjerne.' },
      { senderRole: 'seller', body: 'Topp! Jeg starter i helgen. Sender melding når den er ferdig. Betaling ved ferdigstilling.' },
    ],
  },
  {
    buyerSlug: 'astrid', listingTitle: 'Sjøgras-teppe i alpakka',
    messages: [
      { senderRole: 'buyer', body: 'Hei Maja! Har du dette teppet på lager, eller strikkes det på bestilling?' },
      { senderRole: 'seller', body: 'Det strikkes på bestilling. Ca 3 uker leveringstid. Kan også gjøre andre farger om du ønsker.' },
      { senderRole: 'buyer', body: 'Tenkte det som barselgave. Kan du ha det ferdig innen 20. juni?' },
      { senderRole: 'seller', body: 'Det skal gå fint! Jeg setter det i produksjon med én gang du bekrefter. 600 kr forskudd, resten ved ferdigstilling.' },
    ],
  },
  {
    buyerSlug: 'liv', listingTitle: 'Nydelig dåpskjole str. 68',
    messages: [
      { senderRole: 'buyer', body: 'Hei! Er dette ekte merino? Datteren min skal døpes i august.' },
      { senderRole: 'seller', body: 'Ja, 100% merinoull. Strikket i Sandnes Garn Babyull. Veldig myk og fin.' },
      { senderRole: 'buyer', body: 'Perfekt! Kan jeg se den først? Jeg kan komme til Stavanger.' },
    ],
  },
  {
    buyerSlug: 'ingrid', listingTitle: 'Nordnorsk ragglue i reinsdyrull',
    messages: [
      { senderRole: 'buyer', body: 'Å, den er jo fantastisk! Har du i str. 1–2 år også?' },
      { senderRole: 'seller', body: 'Takk! Ikke akkurat denne, men kan strikke en på bestilling. Blir 380 kr i mindre størrelse.' },
    ],
  },
  {
    buyerSlug: 'astrid', listingTitle: 'Marius-genser str. 110',
    messages: [
      { senderRole: 'buyer', body: 'Så fin! Er fargene klare eller litt falmet?' },
      { senderRole: 'seller', body: 'Fargene er veldig fine fortsatt. Bestemor brukte Dale garn, det holder seg godt.' },
      { senderRole: 'buyer', body: 'Flott, den tar jeg! Kan du sende til Kristiansand?' },
      { senderRole: 'seller', body: 'Klart! Posten Småpakke, ca 80 kr. Totalt 430 kr. Vipps til 45678901 (Tuva).' },
      { senderRole: 'buyer', body: 'Vippset nå! Gleder meg.' },
      { senderRole: 'seller', body: 'Mottatt! Sender i morgen tidlig. Du får sporingsnummer på melding her.' },
    ],
  },
  {
    buyerSlug: 'liv', listingTitle: 'Babysokker str. 0–3 mnd (3 par)',
    messages: [
      { senderRole: 'buyer', body: 'Hei! Har du fler sokker i andre størrelser?' },
      { senderRole: 'seller', body: 'Ikke akkurat nå, men har noen i str. 6–12 mnd som jeg skal legge ut snart!' },
    ],
  },
  {
    buyerSlug: 'sigrid', listingTitle: 'Strikket genser str. 104',
    messages: [
      { senderRole: 'buyer', body: 'Hei, er denne unisex? Tenkte på sønnen min.' },
      { senderRole: 'seller', body: 'Ja, absolutt unisex! Enkel raglan, passer til alle. Jeansbfarge er fin for gutter.' },
    ],
  },
  {
    buyerSlug: 'hanne', listingTitle: 'Handstrikket Morgen-sett str. 86',
    messages: [
      { senderRole: 'buyer', body: 'Nydelig sett! Hvilket garn er brukt?' },
      { senderRole: 'seller', body: 'Peer Gynt fra Sandnes Garn — 100% norsk ull. Veldig slitesterkt og maskinvaskbart.' },
      { senderRole: 'buyer', body: 'Perfekt for nordnorske vintre! Bestiller.' },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────

function log(prefix: string, msg: string) {
  console.log(`  ${prefix} ${msg}`);
}
const ok = (msg: string) => log('\x1b[32m✓\x1b[0m', msg);
const info = (msg: string) => log('\x1b[36m→\x1b[0m', msg);
const warn = (msg: string) => log('\x1b[33m!\x1b[0m', msg);
const heading = (msg: string) => console.log(`\n\x1b[1m${msg}\x1b[0m`);

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║     Strikketorget — Marketplace Seed              ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  // 1. Create / find personas
  heading('Creating personas...');
  const personaMap = new Map<string, string>(); // slug → user_id

  for (const p of PERSONAS) {
    const { data: existing } = await admin.rpc('get_user_by_email', { email_input: p.email }).maybeSingle();

    let userId: string;
    if (existing) {
      userId = existing.id;
      warn(`${p.displayName} (${p.location}) — already exists`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: p.email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: p.displayName },
      });
      if (error) {
        // Try listing users to find by email
        const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
        const found = users?.users?.find(u => u.email === p.email);
        if (found) {
          userId = found.id;
          warn(`${p.displayName} (${p.location}) — found existing`);
        } else {
          console.error(`  Failed to create ${p.email}:`, error.message);
          continue;
        }
      } else {
        userId = data.user.id;
        ok(`${p.displayName} (${p.location}) — ${p.email}`);
      }
    }

    personaMap.set(p.slug, userId);

    // Ensure profile has display_name
    await admin.from('profiles').upsert({
      id: userId,
      display_name: p.displayName,
    }, { onConflict: 'id' });
  }

  // 2. Clean existing test listings + conversations
  heading('Cleaning existing test data...');
  const testUserIds = [...personaMap.values()];

  const { count: deletedMsgs } = await admin
    .from('marketplace_messages')
    .delete({ count: 'exact' })
    .in('sender_id', testUserIds);

  const { count: deletedConvos } = await admin
    .from('marketplace_conversations')
    .delete({ count: 'exact' })
    .in('seller_id', testUserIds);

  // Also delete convos where test users are buyers
  await admin
    .from('marketplace_conversations')
    .delete()
    .in('buyer_id', testUserIds);

  const { count: deletedListings } = await admin
    .from('listings')
    .delete({ count: 'exact' })
    .in('seller_id', testUserIds);

  ok(`Deleted ${deletedListings ?? 0} listings, ${deletedConvos ?? 0} conversations, ${deletedMsgs ?? 0} messages`);

  // 3. Create listings
  heading('Creating listings...');
  const listingIdMap = new Map<string, string>(); // title → listing_id

  for (const l of LISTINGS) {
    const sellerId = personaMap.get(l.sellerSlug);
    if (!sellerId) continue;

    const seller = PERSONAS.find(p => p.slug === l.sellerSlug)!;
    const insertData: Record<string, unknown> = {
      seller_id: sellerId,
      kind: l.kind,
      title: l.title,
      description: l.description,
      price_nok: l.price_nok,
      size_label: l.size_label,
      category: l.category,
      location: l.location,
      shipping_info: l.shipping_info,
      status: l.status === 'sold' ? 'active' : l.status, // set active first, mark sold later
    };
    if (l.size_age_months_min != null) insertData.size_age_months_min = l.size_age_months_min;
    if (l.size_age_months_max != null) insertData.size_age_months_max = l.size_age_months_max;
    if (l.condition) insertData.condition = l.condition;
    if (l.colorway) insertData.colorway = l.colorway;
    if (l.pattern_external_title) insertData.pattern_external_title = l.pattern_external_title;
    if (l.status !== 'draft') {
      insertData.published_at = new Date().toISOString();
      insertData.listing_fee_nok = 29;
    }

    const { data, error } = await admin.from('listings').insert(insertData).select('id').single();
    if (error) {
      console.error(`  Failed: ${l.title}`, error.message);
      continue;
    }

    listingIdMap.set(l.title, data.id);
    const kindLabel = l.kind === 'pre_loved' ? 'brukt' : 'nytt';
    const statusLabel = l.status === 'draft' ? '\x1b[33mutkast\x1b[0m' : l.status === 'sold' ? '\x1b[35msolgt\x1b[0m' : '\x1b[32maktiv\x1b[0m';
    ok(`[${seller.displayName}] ${l.title} — ${l.price_nok} kr (${kindLabel}, ${statusLabel})`);
  }

  // 4. Create conversations + messages
  heading('Simulating conversations...');
  let convoCount = 0;
  let msgCount = 0;

  for (const c of CONVERSATIONS) {
    const listingId = listingIdMap.get(c.listingTitle);
    if (!listingId) {
      warn(`Listing not found: ${c.listingTitle}`);
      continue;
    }

    const buyerId = personaMap.get(c.buyerSlug);
    if (!buyerId) continue;

    // Find the seller from the listing
    const listing = LISTINGS.find(l => l.title === c.listingTitle)!;
    const sellerId = personaMap.get(listing.sellerSlug)!;
    const buyer = PERSONAS.find(p => p.slug === c.buyerSlug)!;
    const seller = PERSONAS.find(p => p.slug === listing.sellerSlug)!;

    const { data: convo, error: convoErr } = await admin
      .from('marketplace_conversations')
      .insert({ listing_id: listingId, buyer_id: buyerId, seller_id: sellerId })
      .select('id')
      .single();

    if (convoErr) {
      console.error(`  Conversation failed:`, convoErr.message);
      continue;
    }

    convoCount++;
    ok(`${buyer.displayName} → ${seller.displayName}: "${c.listingTitle}"`);

    for (let i = 0; i < c.messages.length; i++) {
      const m = c.messages[i];
      const senderId = m.senderRole === 'buyer' ? buyerId : sellerId;
      const senderName = m.senderRole === 'buyer' ? buyer.displayName : seller.displayName;

      // Stagger message timestamps
      const ts = new Date(Date.now() - (c.messages.length - i) * 3600_000).toISOString();

      const { error: msgErr } = await admin.from('marketplace_messages').insert({
        conversation_id: convo.id,
        sender_id: senderId,
        body: m.body,
        created_at: ts,
      });

      if (msgErr) {
        console.error(`    Message failed:`, msgErr.message);
      } else {
        msgCount++;
        log('  ', `\x1b[2m${senderName}: "${m.body.slice(0, 60)}${m.body.length > 60 ? '…' : ''}"\x1b[0m`);
      }
    }
  }

  // 5. Mark sold items
  heading('Marking sold items...');
  for (const l of LISTINGS.filter(l => l.status === 'sold')) {
    const listingId = listingIdMap.get(l.title);
    if (!listingId) continue;

    await admin.from('listings').update({
      status: 'sold',
      sold_at: new Date().toISOString(),
    }).eq('id', listingId);

    const seller = PERSONAS.find(p => p.slug === l.sellerSlug)!;
    ok(`[${seller.displayName}] ${l.title} — marked as sold`);
  }

  // 6. Summary
  const activeCount = LISTINGS.filter(l => l.status === 'active').length;
  const draftCount = LISTINGS.filter(l => l.status === 'draft').length;
  const soldCount = LISTINGS.filter(l => l.status === 'sold').length;

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  Personas:      ${PERSONAS.length}`);
  console.log(`  Listings:      ${LISTINGS.length} (${activeCount} active, ${draftCount} draft, ${soldCount} sold)`);
  console.log(`  Conversations: ${convoCount}`);
  console.log(`  Messages:      ${msgCount}`);
  console.log(`  Password:      ${PASSWORD}`);
  console.log('');
  console.log('  Test panel:    /marked/test-panel');
  console.log('═══════════════════════════════════════════════════');

  console.log('\n  Accounts:');
  for (const p of PERSONAS) {
    console.log(`    ${p.displayName.padEnd(8)} ${p.email.padEnd(35)} ${p.location}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('\nSeed failed:', err);
  process.exit(1);
});
