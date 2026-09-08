// Shared prop/data types for the Phase 2 store editor island.
import type { StoreTheme } from '../../lib/store-theme';
import type { StoreBlock } from '../../lib/store-blocks';

/** A store's own listing, as the featuredProducts multi-select renders it. */
export interface EditorListing {
  id: string;
  title: string;
  price_nok: number;
  hero_photo_path: string | null;
}

/** A store asset row for the asset picker. */
export interface EditorAsset {
  id: string;
  path: string;
  kind: string | null;
  alt: string | null;
}

/** Everything the StoreEditor island is seeded with from the server. The theme
 *  and blocks are the DRAFT starting point (draft ?? live ?? default). */
export interface StoreEditorProps {
  slug: string;
  storeName: string;
  /** The store's own logo (logo_path resolved to a URL), used as the hero
   *  preview fallback when no builder asset is chosen, matching the storefront. */
  storeLogoUrl?: string | null;
  initialTheme: StoreTheme;
  initialBlocks: StoreBlock[];
  initialAssets: EditorAsset[];
  listings: EditorListing[];
}
