// Shared prop shape for every SSR store block. The storefront pre-fetches
// listings + assets once and passes them down, so blocks do no I/O.
import type { Store, PublicStorefront } from '../../../lib/types/stores';
import type { StorefrontListing, StorefrontAsset } from '../../../lib/store-blocks';

export interface StoreBlockProps {
  store: Store;
  props?: Record<string, unknown>;
  listings?: StorefrontListing[];
  assets?: StorefrontAsset[];
  /** Storefront-visible members, used by the `team` block. Other blocks ignore it. */
  members?: PublicStorefront['publicMembers'];
  /** Current viewer's relationship to the store, used by the `storeActions`
   *  block (favourite/follow). Other blocks ignore it. */
  viewer?: StoreViewer;
}

export interface StoreViewer {
  loggedIn: boolean;
  isMember: boolean;
  isFollowing: boolean;
  isFavorite: boolean;
}
