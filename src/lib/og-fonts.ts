// Google Fonts returns WOFF2 by default, which Satori does not accept on
// Cloudflare Workers (no built-in WOFF2 decoder). The trick: send an
// "old IE" User-Agent and Google falls back to TTF in the @font-face URLs.

const IE_UA = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.0)';

let frauncesCache: ArrayBuffer | null = null;
let interCache: ArrayBuffer | null = null;
let interBoldCache: ArrayBuffer | null = null;

async function fetchTTF(family: string, weight: number, italic = false): Promise<ArrayBuffer> {
  const familyParam = italic ? `${family}:i` : `${family}:${weight}`;
  const cssUrl = `https://fonts.googleapis.com/css?family=${encodeURIComponent(familyParam)}`;
  const cssRes = await fetch(cssUrl, { headers: { 'user-agent': IE_UA } });
  if (!cssRes.ok) throw new Error(`Google Fonts CSS fetch failed: ${cssRes.status}`);
  const css = await cssRes.text();
  const match = css.match(/url\(([^)]+\.ttf)\)/);
  if (!match) throw new Error(`No TTF url for ${family} ${weight}`);
  const ttfRes = await fetch(match[1]);
  if (!ttfRes.ok) throw new Error(`Font fetch failed: ${ttfRes.status}`);
  return ttfRes.arrayBuffer();
}

export async function loadOgFonts() {
  if (!frauncesCache) frauncesCache = await fetchTTF('Fraunces', 500);
  if (!interCache) interCache = await fetchTTF('Inter', 500);
  if (!interBoldCache) interBoldCache = await fetchTTF('Inter', 700);
  return {
    fraunces: frauncesCache,
    inter: interCache,
    interBold: interBoldCache,
  };
}
