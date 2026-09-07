// Starter storefront presets: ready-made { theme, page_config } combos a store
// owner (Phase 2 editor) or a seed can apply in one click. Each preset only
// uses the curated fonts (store-theme.ts) and the core blocks (store-blocks.ts),
// so applying one always produces a valid, renderable storefront.

import type { StoreTheme } from './store-theme';
import type { StorePageConfig } from './store-blocks';

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
        text: '#2C2A26',
        muted: '#7A7267',
        border: '#E7DCCB',
        primary: '#C06A45',
        primaryFg: '#FBF6EF',
        accent: '#9CAF88',
        headerBg: '#3A2A20',
      },
      fontDisplay: 'fraunces',
      fontBody: 'inter',
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
        text: '#1F1E1C',
        muted: '#8A867E',
        border: '#EAE8E2',
        primary: '#2C7A8C',
        primaryFg: '#FFFFFF',
        accent: '#6C9C9A',
        headerBg: '#1F2A2C',
      },
      fontDisplay: 'space-grotesk',
      fontBody: 'dm-sans',
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
        text: '#ECE7DE',
        muted: '#A8A29A',
        border: '#3A362F',
        primary: '#E08A6B',
        primaryFg: '#1B1A18',
        accent: '#C3A8E0',
        headerBg: '#0F0E0C',
      },
      fontDisplay: 'playfair',
      fontBody: 'inter',
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
