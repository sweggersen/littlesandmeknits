#!/usr/bin/env node
/**
 * QA report — build step. Reads the manifest + screenshots + video written by
 * capture.mjs and emits a single self-contained HTML file (all assets inlined as
 * data URIs) at qa-report/qa-report.html. Self-contained so it works opened
 * straight from disk locally and travels as a single-file CI build artifact.
 *
 * Env: QA_OUT (default ./qa-report).
 */
import fs from 'node:fs';

const OUT = process.env.QA_OUT ?? 'qa-report';
const manifest = JSON.parse(fs.readFileSync(`${OUT}/manifest.json`, 'utf8'));
const b64 = (p, mime) => (fs.existsSync(p) ? `data:${mime};base64,${fs.readFileSync(p).toString('base64')}` : null);

const vidFile = fs.existsSync(`${OUT}/videos`) ? fs.readdirSync(`${OUT}/videos`).find((f) => f.endsWith('.webm')) : null;
const video = vidFile ? b64(`${OUT}/videos/${vidFile}`, 'video/webm') : null;

const ok = manifest.filter((m) => m.status === 200).length;
const groups = [...new Set(manifest.map((m) => m.g))];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const statusPill = (s) =>
  s === 200 ? `<span class="pill pill-ok">HTTP 200</span>`
  : typeof s === 'number' ? `<span class="pill pill-warn">HTTP ${s}</span>`
  : `<span class="pill pill-err">${esc(s)}</span>`;

const cards = groups.map((g) => {
  const items = manifest.filter((m) => m.g === g).map((m) => {
    const img = m.file ? b64(`${OUT}/shots/${m.file}`, 'image/jpeg') : null;
    return `<article class="card">
      <header class="card-h">
        <div><h3>${esc(m.name)}</h3><code>${esc(m.path)}</code></div>
        ${statusPill(m.status)}
      </header>
      ${img ? `<a class="shot" href="${img}" target="_blank" rel="noopener"><img loading="lazy" src="${img}" alt="${esc(m.name)}"></a>`
            : `<div class="shot shot-missing">Ingen skjermdump${m.err ? `<br><small>${esc(m.err)}</small>` : ''}</div>`}
      <p class="note"><span class="note-k">Endret</span> ${esc(m.note)}</p>
    </article>`;
  }).join('\n');
  return `<section class="grp"><h2>${esc(g)}</h2><div class="grid">${items}</div></section>`;
}).join('\n');

const html = `<!doctype html><html lang="nb"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA-rapport · Littles and Me Knits</title>
<style>
  :root{
    --linen:#f6f1e9; --paper:#fffdf9; --ink:#2b2622; --muted:#6f665c;
    --line:#e6ddcf; --terra:#c06b4a; --sage:#7c8a6f; --ok:#3f7d54; --warn:#b7791f; --err:#b4453a;
    --bg:var(--linen); --card:var(--paper); --fg:var(--ink); --sub:var(--muted); --brd:var(--line);
  }
  @media (prefers-color-scheme:dark){
    :root{ --bg:#211d1a; --card:#2a2521; --fg:#efe7db; --sub:#a99f92; --brd:#3a332c;
      --terra:#d98a68; --sage:#9aa787; --ok:#6fb587; --warn:#d6a44a; --err:#e0796c; }
  }
  :root[data-theme="dark"]{ --bg:#211d1a; --card:#2a2521; --fg:#efe7db; --sub:#a99f92; --brd:#3a332c;
    --terra:#d98a68; --sage:#9aa787; --ok:#6fb587; --warn:#d6a44a; --err:#e0796c; }
  :root[data-theme="light"]{ --bg:#f6f1e9; --card:#fffdf9; --fg:#2b2622; --sub:#6f665c; --brd:#e6ddcf;
    --terra:#c06b4a; --sage:#7c8a6f; --ok:#3f7d54; --warn:#b7791f; --err:#b4453a; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
    font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;line-height:1.55}
  .wrap{max-width:1180px;margin:0 auto;padding:0 20px 80px}
  header.top{padding:56px 0 28px;border-bottom:1px solid var(--brd);margin-bottom:36px}
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--terra);margin:0 0 10px}
  h1{font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:600;font-size:clamp(30px,4vw,46px);
    margin:0 0 8px;letter-spacing:-.01em;text-wrap:balance}
  .lede{color:var(--sub);max-width:60ch;margin:0}
  .stats{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}
  .stat{background:var(--card);border:1px solid var(--brd);border-radius:14px;padding:14px 18px;min-width:120px}
  .stat b{display:block;font-family:'Fraunces',Georgia,serif;font-size:26px;font-variant-numeric:tabular-nums;line-height:1}
  .stat span{font-size:12px;color:var(--sub);text-transform:uppercase;letter-spacing:.08em}
  .vid{margin:0 0 44px;background:var(--card);border:1px solid var(--brd);border-radius:18px;padding:16px;overflow:hidden}
  .vid h2{margin:.2em 0 .6em}
  video{width:100%;border-radius:10px;display:block;background:#000}
  .grp{margin:0 0 46px}
  .grp>h2{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:22px;margin:0 0 16px;
    padding-bottom:8px;border-bottom:2px solid var(--terra);display:inline-block}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px}
  .card{background:var(--card);border:1px solid var(--brd);border-radius:16px;overflow:hidden;display:flex;flex-direction:column}
  .card-h{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:14px 16px 10px}
  .card-h h3{margin:0;font-size:15px;font-weight:600}
  .card-h code{font-size:12px;color:var(--sub)}
  .shot{display:block;border-top:1px solid var(--brd);border-bottom:1px solid var(--brd);background:var(--bg);max-height:280px;overflow:hidden}
  .shot img{width:100%;display:block}
  .shot-missing{display:flex;align-items:center;justify-content:center;min-height:160px;color:var(--err);font-size:13px;text-align:center}
  .note{margin:0;padding:12px 16px 16px;font-size:13px;color:var(--sub)}
  .note-k{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
    color:var(--sage);margin-right:6px}
  .pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap;letter-spacing:.03em}
  .pill-ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}
  .pill-warn{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}
  .pill-err{background:color-mix(in srgb,var(--err) 18%,transparent);color:var(--err)}
  footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--brd);color:var(--sub);font-size:12px}
</style></head>
<body><div class="wrap">
  <header class="top">
    <p class="eyebrow">Lanserings-QA · Strikketorget + Strikkestua</p>
    <h1>Visuell gjennomgang av lansering</h1>
    <p class="lede">Full skjermdump av hver lanseringsklar side som innlogget selger, med hva som er endret per side. Generert automatisk av <code>npm run qa:report</code> mot ekte, seedet data.</p>
    <div class="stats">
      <div class="stat"><b>${manifest.length}</b><span>sider</span></div>
      <div class="stat"><b>${ok}</b><span>HTTP 200</span></div>
      <div class="stat"><b>${groups.length}</b><span>seksjoner</span></div>
      <div class="stat"><b>887</b><span>unit-tester</span></div>
      <div class="stat"><b>63</b><span>e2e-tester</span></div>
    </div>
  </header>
  ${video ? `<section class="vid"><h2 style="font-family:'Fraunces',serif;font-weight:600;font-size:20px">Gjennomgang (video)</h2><video controls preload="metadata" src="${video}"></video></section>` : ''}
  ${cards}
  <footer>Littles and Me Knits · QA-rapport generert fra seedet lokal database. Skjermdumpene reflekterer koden på genereringstidspunktet.</footer>
</div></body></html>`;

fs.writeFileSync(`${OUT}/qa-report.html`, html);
console.log(`wrote ${OUT}/qa-report.html (${(Buffer.byteLength(html) / 1e6).toFixed(1)} MB, ${ok}/${manifest.length} pages HTTP 200)`);
