// Shared prop shape for every SSR store block. The storefront pre-fetches
// listings + assets once and passes them down, so blocks do no I/O.
import type { Store } from '../../../lib/types/stores';
import type { StorefrontListing, StorefrontAsset } from '../../../lib/store-blocks';

export interface StoreBlockProps {
  store: Store;
  props?: Record<string, unknown>;
  listings?: StorefrontListing[];
  assets?: StorefrontAsset[];
}
