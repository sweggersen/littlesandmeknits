// Refuses to let a deploy ship a bundle with the wrong Supabase URL baked in.
//
// PUBLIC_* env is inlined at build time, and the Cloudflare adapter gives
// .dev.vars (localhost values) top priority — so a laptop build silently bakes
// 127.0.0.1 and every Supabase-touching page 500s in prod (the 2026-06/07
// strikketorget.no outage). The CI deploy job has its own assertion step; this
// script guards the MANUAL path: it runs from wrangler.jsonc's build.command,
// so a plain `wrangler deploy` from a checkout hits it too.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist/server/chunks';
let sawProd = false;
let sawLocal = false;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.mjs')) continue;
  const src = readFileSync(join(dir, f), 'utf8');
  if (src.includes('.supabase.co')) sawProd = true;
  if (src.includes('127.0.0.1:54321')) sawLocal = true;
}

if (!sawProd || sawLocal) {
  console.error(
    `\n✗ Refusing to deploy: the server bundle baked ${sawLocal ? 'a LOCALHOST Supabase URL' : 'NO Supabase URL'}.\n` +
    '  PUBLIC_SUPABASE_URL is inlined at build time and .dev.vars (localhost) wins over\n' +
    '  everything. Deploy through CI, or move .dev.vars aside and export the prod\n' +
    '  PUBLIC_* values before building. See CLAUDE.md "PUBLIC_* env is baked at build time".\n',
  );
  process.exit(1);
}
console.log('✓ prod Supabase URL baked into the server bundle');
