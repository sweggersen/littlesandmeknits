// Satori on Cloudflare Workers needs TTF (no built-in WOFF2 decoder).
// We pull the variable-font TTFs straight from the Google Fonts repo via
// jsDelivr — the previous "old IE User-Agent" trick on fonts.googleapis.com
// stopped serving TTF for variable fonts. Satori v0.10+ handles variable
// fonts and picks the closest instance for the requested weight.

const FONT_URLS = {
  fraunces: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf',
  inter: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/inter/Inter%5Bopsz,wght%5D.ttf',
} as const;

let frauncesCache: ArrayBuffer | null = null;
let interCache: ArrayBuffer | null = null;

async function fetchTTF(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed (${res.status}): ${url}`);
  return res.arrayBuffer();
}

export async function loadOgFonts() {
  const [fraunces, inter] = await Promise.all([
    frauncesCache ? Promise.resolve(frauncesCache) : fetchTTF(FONT_URLS.fraunces),
    interCache ? Promise.resolve(interCache) : fetchTTF(FONT_URLS.inter),
  ]);
  frauncesCache = fraunces;
  interCache = inter;
  // Inter variable covers both regular and bold via weight axis; satori uses
  // the same buffer for multiple weight registrations.
  return { fraunces, inter, interBold: inter };
}
