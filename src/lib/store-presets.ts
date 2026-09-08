// Starter storefront presets: ready-made { theme, page_config } combos a store
// owner (Phase 2 editor) or a seed can apply in one click. Each preset only
// uses the curated fonts (store-theme.ts) and the core blocks (store-blocks.ts),
// so applying one always produces a valid, renderable storefront.

import type { StoreTheme } from './store-theme';
import { DEFAULT_STORE_THEME } from './store-theme';
import type { StorePageConfig, StoreBlock } from './store-blocks';

export interface StorePreset {
  id: string;
  label: string;
  description: string;
  theme: StoreTheme;
  page_config: StorePageConfig;
}

// Shared block skeleton every preset reuses; each preset overrides the theme +
// hero tagline / text copy. Blocks flow top-to-bottom by `y`.
function baseBlocks(opts: { tagline: string; aboutHeading: string; aboutBody: string }): StorePageConfig {
  return {
    blocks: [
      {
        id: 'hero',
        type: 'hero',
        layout: { x: 0, y: 0, w: 12, h: 3 },
        props: { showBanner: true, tagline: opts.tagline, ctaText: '', ctaHref: '' },
      },
      {
        id: 'about',
        type: 'textSection',
        layout: { x: 0, y: 1, w: 8, h: 3 },
        props: { heading: opts.aboutHeading, body: opts.aboutBody },
      },
      {
        id: 'contact',
        type: 'contactInfo',
        layout: { x: 8, y: 1, w: 4, h: 3 },
        props: { heading: 'Kontakt' },
      },
      {
        id: 'products',
        type: 'productGrid',
        layout: { x: 0, y: 2, w: 12, h: 5 },
        props: { heading: 'Annonser', limit: 24 },
      },
    ],
  };
}

export const STORE_PRESETS: Record<string, StorePreset> = {
  'varm-klassisk': {
    id: 'varm-klassisk',
    label: 'Varm klassisk',
    description: 'Lune jordfarger, serif-overskrifter. Føles håndlaget og tidløst.',
    theme: {
      colors: {
        page: '#FAF4EC',
        surface: '#FFFFFF',
        heading: '#3A2A20',
        text: '#2C2A26',
        muted: '#7A7267',
        border: '#E7DCCB',
        primary: '#C06A45',
        primaryFg: '#FBF6EF',
        accent: '#9CAF88',
        headerBg: '#3A2A20',
        tag: '#8A9A5B',
      },
      fontDisplay: 'fraunces',
      fontBody: 'inter',
      heading: { weight: 'semibold', italic: false, underline: false, scale: 'base' },
      body: { weight: 'normal', italic: false, underline: false, scale: 'base' },
    },
    page_config: baseBlocks({
      tagline: 'Håndlagde plagg, strikket med omtanke.',
      aboutHeading: 'Om butikken',
      aboutBody:
        'Vi strikker i naturlige garn og små serier. Hvert plagg er unikt, laget for å vare i mange år.',
    }),
  },

  'ren-minimal': {
    id: 'ren-minimal',
    label: 'Ren minimal',
    description: 'Lyst og luftig med moderne sans-serif. Lar produktene snakke.',
    theme: {
      colors: {
        page: '#FBFBF9',
        surface: '#FFFFFF',
        heading: '#1F1E1C',
        text: '#1F1E1C',
        muted: '#8A867E',
        border: '#EAE8E2',
        primary: '#2C7A8C',
        primaryFg: '#FFFFFF',
        accent: '#6C9C9A',
        headerBg: '#1F2A2C',
        tag: '#3E6E6C',
      },
      fontDisplay: 'space-grotesk',
      fontBody: 'dm-sans',
      heading: { weight: 'medium', italic: false, underline: false, scale: 'base' },
      body: { weight: 'normal', italic: false, underline: false, scale: 'base' },
    },
    page_config: baseBlocks({
      tagline: 'Enkelt, ærlig håndverk.',
      aboutHeading: 'Om oss',
      aboutBody:
        'En liten strikkebutikk med fokus på rene linjer og god passform. Vi holder utvalget lite og kvaliteten høy.',
    }),
  },

  dristig: {
    id: 'dristig',
    label: 'Dristig',
    description: 'Høy kontrast, elegant Playfair-overskrift. For butikker som vil skille seg ut.',
    theme: {
      colors: {
        page: '#1B1A18',
        surface: '#262421',
        heading: '#F6F1E8',
        text: '#ECE7DE',
        muted: '#A8A29A',
        border: '#3A362F',
        primary: '#E08A6B',
        primaryFg: '#1B1A18',
        accent: '#C3A8E0',
        headerBg: '#0F0E0C',
        tag: '#5B4B7A',
      },
      fontDisplay: 'playfair',
      fontBody: 'inter',
      heading: { weight: 'bold', italic: false, underline: false, scale: 'lg' },
      body: { weight: 'normal', italic: false, underline: false, scale: 'base' },
    },
    page_config: baseBlocks({
      tagline: 'Strikk med karakter.',
      aboutHeading: 'Historien vår',
      aboutBody:
        'Vi lager statement-plagg i dype farger og markante mønstre. Strikk som legges merke til.',
    }),
  },
};

export const STORE_PRESET_IDS = Object.keys(STORE_PRESETS);

export function getPreset(id: string): StorePreset | null {
  return Object.prototype.hasOwnProperty.call(STORE_PRESETS, id) ? STORE_PRESETS[id] : null;
}

/**
 * The platform default storefront expressed as a real builder config — the
 * brand-aligned DEFAULT_STORE_THEME plus a page_config of core blocks. Every
 * store renders through this one themed pipeline: a store with no saved config
 * falls back to exactly this, and the editor seeds it for a never-configured
 * store, so "the default" and "what you can edit" are the same thing.
 *
 * The hero + contact blocks read the store's own name / logo / banner / contact
 * fields; the about block is included only when the store has a description
 * (an empty text panel would look broken).
 */
export function buildDefaultStorePage(
  store?: { description?: string | null } | null,
): { theme: StoreTheme; page_config: StorePageConfig } {
  const about = (store?.description ?? '').trim();
  const blocks: StoreBlock[] = [
    // props omit title/tagline so the hero falls back to the store's own name +
    // tagline; showBanner uses the store's banner_path when present.
    { id: 'hero', type: 'hero', layout: { x: 0, y: 0, w: 12, h: 3 }, props: { showBanner: true } },
  ];
  if (about) {
    blocks.push(
      { id: 'about', type: 'textSection', layout: { x: 0, y: 1, w: 8, h: 3 }, props: { heading: 'Om butikken', body: about } },
      { id: 'contact', type: 'contactInfo', layout: { x: 8, y: 1, w: 4, h: 3 }, props: { heading: 'Kontakt' } },
    );
  } else {
    blocks.push(
      { id: 'contact', type: 'contactInfo', layout: { x: 0, y: 1, w: 12, h: 2 }, props: { heading: 'Kontakt' } },
    );
  }
  blocks.push({ id: 'products', type: 'productGrid', layout: { x: 0, y: 2, w: 12, h: 5 }, props: { heading: 'Annonser', limit: 24 } });
  return { theme: DEFAULT_STORE_THEME, page_config: { blocks } };
}
