// Shared types for the store feature. Used by services, API routes, pages,
// and (later) the mobile app. Keep this surface stable.

export type StoreRole = 'owner' | 'admin' | 'manager' | 'contributor';
export type StoreStatus = 'draft' | 'pending_review' | 'active' | 'suspended' | 'archived';
export type StoreTier = 'starter' | 'pro' | 'elite';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled';
export type OrgnrStatus = 'normal' | 'deleted' | 'bankrupt' | 'liquidation';

/** A store as stored in the database. */
export interface Store {
  id: string;
  slug: string;
  orgnr: string;

  // Canonical (locked) data from Brønnøysund
  legal_name: string;
  legal_address: string | null;
  legal_business_type: string | null;
  legal_industry_code: string | null;
  legal_status: string | null;
  legal_founded_date: string | null;

  // Storefront-customizable
  name: string;
  tagline: string | null;
  description: string | null;
  banner_path: string | null;
  logo_path: string | null;
  accent_color: string | null;

  // Contact
  location_city: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website_url: string | null;
  instagram_url: string | null;
  etsy_url: string | null;
  pinterest_url: string | null;
  tiktok_url: string | null;
  opening_hours: Record<string, string> | null;

  // Subscription
  tier: StoreTier;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus;

  // Stripe Connect
  stripe_account_id: string | null;
  stripe_onboarded: boolean;

  // Lifecycle
  status: StoreStatus;
  verified: boolean;
  promo_year_one_free: boolean;
  created_at: string;
  created_by: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  approved_at: string | null;
  deleted_at: string | null;
}

export interface StoreMember {
  id: string;
  store_id: string;
  user_id: string;
  role: StoreRole;
  visible_on_storefront: boolean;
  public_title: string | null;
  joined_at: string;
  invited_by: string | null;
}

export interface StoreInvitation {
  id: string;
  store_id: string;
  email: string;
  role: StoreRole;
  token: string;
  expires_at: string;
  invited_by: string;
  accepted_at: string | null;
  accepted_by: string | null;
  created_at: string;
}

/** A member joined with their profile for display in admin UIs. */
export interface StoreMemberWithProfile extends StoreMember {
  display_name: string | null;
  email: string | null;
  avatar_path: string | null;
}

/** Shape returned to the public storefront page. */
export interface PublicStorefront {
  store: Pick<
    Store,
    'id' | 'slug' | 'name' | 'tagline' | 'description' | 'banner_path' | 'logo_path'
    | 'accent_color' | 'location_city' | 'contact_email' | 'contact_phone'
    | 'website_url' | 'instagram_url' | 'etsy_url' | 'pinterest_url' | 'tiktok_url'
    | 'opening_hours' | 'verified' | 'legal_name' | 'legal_address' | 'created_at'
  >;
  publicMembers: Array<{
    user_id: string;
    display_name: string | null;
    avatar_path: string | null;
    public_title: string | null;
    role: StoreRole;
  }>;
}

/** Result type for orgnr lookup (re-exported from brreg for service use). */
export type { OrgnrData, OrgnrLookupResult, OrgnrLookupError } from '../brreg';
