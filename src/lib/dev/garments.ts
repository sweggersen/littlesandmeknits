// Category-matched garment illustrations for seeded listings/demo data.
// Pure SVG (no canvas), so it runs in the Cloudflare Worker. Each garment is a
// simple, recognizable silhouette in the listing's colourway with a subtle knit
// texture, on a soft linen card background — so a "lue" listing shows a hat, a
// "votter" listing shows mittens, etc., instead of an anonymous colour block.
//
// Used by the dev world-seeder (src/lib/dev/seed-world.ts) via test-exec's
// create-listing image_style:'garment'. Not shipped to users.

const BG = '#f7f2ea';       // linen card

/** Darken a `RRGGBB` hex by mixing toward black, for outlines/shading. */
function shade(hex: string, factor = 0.72): string {
  const n = parseInt(hex, 16);
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >> 8) & 0xff) * factor);
  const b = Math.round((n & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** One mitten (hand + thumb + cuff) with its left edge at x-offset `dx`. */
function mitten(dx: number): string {
  return `<path d="M${dx + 14} 176 Q${dx + 14} 140 ${dx + 38} 140 Q${dx + 62} 140 ${dx + 62} 176 L${dx + 62} 204 Q${dx + 78} 200 ${dx + 78} 184 Q${dx + 78} 170 ${dx + 66} 170 Q${dx + 60} 170 ${dx + 60} 182 L${dx + 60} 248 L${dx + 14} 248 Z"/>
    <rect x="${dx + 10}" y="246" width="54" height="26" rx="8"/>`;
}
/** One L-shaped sock (leg + foot) with its left edge at x-offset `dx`. */
function sock(dx: number): string {
  return `<path d="M${dx + 30} 120 L${dx + 78} 120 L${dx + 78} 226 L${dx + 140} 226 Q${dx + 150} 226 ${dx + 150} 250 L${dx + 150} 272 L${dx + 30} 272 Z"/>
    <path d="M${dx + 30} 146 L${dx + 78} 146" fill="none"/>`;
}

// The garment shapes. Each returns SVG markup drawn on a 400×400 canvas,
// filled with `url(#knit)` (the colourway + knit texture) and outlined.
const SHAPES: Record<string, () => string> = {
  genser: () => `
    <path d="M168 150 Q200 140 232 150 L252 156 L302 206 L278 250 L252 230 L252 342 L148 342 L148 230 L122 250 L98 206 L148 156 Z"
      fill="url(#knit)" stroke="${'STROKE'}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M180 152 Q200 168 220 152" fill="none" stroke="${'STROKE'}" stroke-width="4"/>`,
  cardigan: () => `
    <path d="M168 150 Q200 140 232 150 L252 156 L302 206 L278 250 L252 230 L252 342 L148 342 L148 230 L122 250 L98 206 L148 156 Z"
      fill="url(#knit)" stroke="${'STROKE'}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M200 158 L200 342 M180 152 L200 178 L220 152" fill="none" stroke="${'STROKE'}" stroke-width="4"/>
    <circle cx="200" cy="214" r="5" fill="${'STROKE'}"/><circle cx="200" cy="256" r="5" fill="${'STROKE'}"/><circle cx="200" cy="298" r="5" fill="${'STROKE'}"/>`,
  lue: () => `
    <path d="M118 250 Q108 140 200 128 Q292 140 282 250 Z" fill="url(#knit)" stroke="${'STROKE'}" stroke-width="4" stroke-linejoin="round"/>
    <rect x="112" y="244" width="176" height="40" rx="18" fill="url(#knit)" stroke="${'STROKE'}" stroke-width="4"/>
    <circle cx="200" cy="104" r="24" fill="url(#knit)" stroke="${'STROKE'}" stroke-width="4"/>`,
  votter: () => `
    <g stroke="${'STROKE'}" stroke-width="4" stroke-linejoin="round" fill="url(#knit)">
      ${mitten(96)}
      ${mitten(222)}
    </g>`,
  sokker: () => `
    <g stroke="${'STROKE'}" stroke-width="4" stroke-linejoin="round" fill="url(#knit)">
      ${sock(70)}
      ${sock(158)}
    </g>`,
  teppe: () => `
    <rect x="96" y="120" width="208" height="180" rx="10" fill="url(#knit)" stroke="${'STROKE'}" stroke-width="4"/>
    <path d="M96 168 L304 168 M96 216 L304 216 M96 264 L304 264" stroke="${'STROKE'}" stroke-width="2" opacity="0.5"/>
    <g stroke="${'STROKE'}" stroke-width="3">
      <path d="M104 300 l0 22 M128 300 l0 22 M152 300 l0 22 M176 300 l0 22 M200 300 l0 22 M224 300 l0 22 M248 300 l0 22 M272 300 l0 22 M296 300 l0 22"/>
    </g>`,
  kjole: () => `
    <path d="M165 138 Q200 130 235 138 L232 200 L288 338 L112 338 L168 200 Z" fill="url(#knit)" stroke="${'STROKE'}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M165 138 Q200 156 235 138" fill="none" stroke="${'STROKE'}" stroke-width="4"/>
    <path d="M168 200 L232 200" stroke="${'STROKE'}" stroke-width="3" opacity="0.6"/>`,
  bukser: () => `
    <path d="M152 152 L248 152 L244 338 L210 338 L201 222 L199 222 L190 338 L156 338 Z"
      fill="url(#knit)" stroke="${'STROKE'}" stroke-width="4" stroke-linejoin="round"/>
    <rect x="150" y="128" width="100" height="26" rx="6" fill="url(#knit)" stroke="${'STROKE'}" stroke-width="4"/>`,
  annet: () => `
    <circle cx="200" cy="230" r="92" fill="url(#knit)" stroke="${'STROKE'}" stroke-width="4"/>
    <path d="M138 190 Q200 230 262 190 M138 270 Q200 230 262 270 M170 148 Q200 230 170 312 M230 148 Q200 230 230 312"
      fill="none" stroke="${'STROKE'}" stroke-width="2" opacity="0.55"/>
    <path d="M150 120 L300 300 M250 120 L100 300" stroke="${'STROKE'}" stroke-width="7" stroke-linecap="round"/>`,
};

const ALIAS: Record<string, string> = { jakke: 'cardigan', body: 'genser', topp: 'genser', skjerf: 'teppe', accessory: 'votter' };

/** An SVG illustration (as a string) of the garment for `category`, in colour
 *  `hex` (RRGGBB, no '#'). Falls back to a yarn-ball for unknown categories. */
export function garmentSvg(category: string, hex: string): string {
  const key = SHAPES[category] ? category : (ALIAS[category] ?? 'annet');
  const body = SHAPES[key]().replaceAll('STROKE', shade(hex));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <pattern id="knit" width="16" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(0)">
      <rect width="16" height="14" fill="#${hex}"/>
      <path d="M0 12 L8 4 L16 12 M-8 12 L0 4 M8 12 L16 4 L24 12" fill="none" stroke="${shade(hex, 0.86)}" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="400" height="400" fill="${BG}"/>
  ${body}
</svg>`;
}

/** SVG bytes ready to upload to storage (content-type image/svg+xml). */
export function garmentSvgBytes(category: string, hex: string): Uint8Array {
  return new TextEncoder().encode(garmentSvg(category, hex));
}
