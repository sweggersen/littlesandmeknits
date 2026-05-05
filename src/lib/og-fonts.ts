// Satori on Cloudflare Workers needs TTF, and its OpenType parser crashes
// on the variable-font fvar table that Google's variable TTFs ship with
// ("Cannot read properties of undefined (reading '256')" inside
// parseFvarAxis). Pull static, non-variable TTFs from fonts.gstatic.com
// instead — Google still serves these for the legacy CSS API. URLs were
// resolved via google-webfonts-helper.

const FONT_URLS = {
  fraunces500:
    'https://fonts.gstatic.com/s/fraunces/v38/6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib1603gg7S2nfgRYIchRuTCf7W.ttf',
  inter500:
    'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fAZ9hjQ.ttf',
  inter700:
    'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZ9hjQ.ttf',
} as const;

let frauncesCache: ArrayBuffer | null = null;
let interCache: ArrayBuffer | null = null;
let interBoldCache: ArrayBuffer | null = null;

async function fetchTTF(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed (${res.status}): ${url}`);
  return res.arrayBuffer();
}

export async function loadOgFonts() {
  const [fraunces, inter, interBold] = await Promise.all([
    frauncesCache ? Promise.resolve(frauncesCache) : fetchTTF(FONT_URLS.fraunces500),
    interCache ? Promise.resolve(interCache) : fetchTTF(FONT_URLS.inter500),
    interBoldCache ? Promise.resolve(interBoldCache) : fetchTTF(FONT_URLS.inter700),
  ]);
  frauncesCache = fraunces;
  interCache = inter;
  interBoldCache = interBold;
  return { fraunces, inter, interBold };
}
