-- Stores: business entities that own listings.
-- Gated by Norwegian orgnr (organisasjonsnummer). One user can be a member
-- of many stores. Stores own listings and are the seller of record for
-- store-owned listings.

CREATE TYPE store_member_role AS ENUM ('owner', 'admin', 'manager', 'contributor');
CREATE TYPE store_status AS ENUM ('draft', 'pending_review', 'active', 'suspended', 'archived');
CREATE TYPE store_tier AS ENUM ('starter', 'pro', 'elite');

CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  orgnr text NOT NULL UNIQUE,

  -- Canonical data from Brønnøysundregistrene (locked after lookup)
  legal_name text NOT NULL,
  legal_address text,
  legal_business_type text,
  legal_industry_code text,
  legal_status text,
  legal_founded_date date,

  -- Storefront customizable fields
  name text NOT NULL,
  tagline text,
  description text,
  banner_path text,
  logo_path text,
  accent_color text,

  -- Contact / location
  location_city text,
  contact_email text,
  contact_phone text,
  website_url text,
  instagram_url text,
  etsy_url text,
  pinterest_url text,
  tiktok_url text,
  opening_hours jsonb,

  -- Subscription (paying us)
  tier store_tier NOT NULL DEFAULT 'starter',
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text DEFAULT 'trialing',

  -- Stripe Connect (we pay them)
  stripe_account_id text,
  stripe_onboarded boolean DEFAULT false,

  -- Status & moderation
  status store_status NOT NULL DEFAULT 'draft',
  verified boolean DEFAULT false,
  promo_year_one_free boolean DEFAULT false,

  -- Lifecycle
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  deleted_at timestamptz
);

COMMENT ON TABLE public.stores IS 'Business entities (stores) that own listings. Gated by Norwegian orgnr.';
COMMENT ON COLUMN public.stores.orgnr IS 'Norwegian 9-digit organisasjonsnummer from Brønnøysundregistrene';
COMMENT ON COLUMN public.stores.legal_name IS 'Canonical business name from Brønnøysund (read-only after lookup)';
COMMENT ON COLUMN public.stores.name IS 'Display name for the storefront (customizable, defaults to legal_name)';
COMMENT ON COLUMN public.stores.promo_year_one_free IS 'First 20 approved stores get year-1-free as launch promo';
COMMENT ON COLUMN public.stores.deleted_at IS 'Soft delete; cron purges after 90 days';

CREATE INDEX idx_stores_status ON public.stores(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_stores_slug ON public.stores(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_stores_orgnr ON public.stores(orgnr) WHERE deleted_at IS NULL;
CREATE INDEX idx_stores_created_by ON public.stores(created_by);
CREATE INDEX idx_stores_deleted_at ON public.stores(deleted_at) WHERE deleted_at IS NOT NULL;

-- Membership
CREATE TABLE public.store_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role store_member_role NOT NULL DEFAULT 'contributor',
  visible_on_storefront boolean DEFAULT false,
  public_title text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  invited_by uuid REFERENCES public.profiles(id),
  UNIQUE (store_id, user_id)
);

COMMENT ON TABLE public.store_members IS 'Users belonging to a store with their role and storefront visibility.';

CREATE INDEX idx_store_members_store ON public.store_members(store_id);
CREATE INDEX idx_store_members_user ON public.store_members(user_id);
CREATE INDEX idx_store_members_role ON public.store_members(store_id, role);

-- Pending invitations
CREATE TABLE public.store_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  email text NOT NULL,
  role store_member_role NOT NULL DEFAULT 'contributor',
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  invited_by uuid NOT NULL REFERENCES public.profiles(id),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.store_invitations IS 'Pending email invites to join a store. Token-based, time-limited.';

CREATE INDEX idx_store_invitations_store ON public.store_invitations(store_id) WHERE accepted_at IS NULL;
CREATE INDEX idx_store_invitations_email ON public.store_invitations(email) WHERE accepted_at IS NULL;
CREATE INDEX idx_store_invitations_token ON public.store_invitations(token);

-- Listings can be owned by a store (in addition to having a seller_id member)
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_listings_store_id ON public.listings(store_id) WHERE store_id IS NOT NULL;
COMMENT ON COLUMN public.listings.store_id IS 'If set, the listing is owned by a store. seller_id stays as the member who created it.';

-- Reviews of store-owned listings get attached to the store
ALTER TABLE public.seller_reviews
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_seller_reviews_store ON public.seller_reviews(store_id) WHERE store_id IS NOT NULL;

-- Row Level Security
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_invitations ENABLE ROW LEVEL SECURITY;

-- stores: public can read active, non-deleted stores
CREATE POLICY "stores_select_public_active"
  ON public.stores FOR SELECT
  USING (status = 'active' AND deleted_at IS NULL);

-- stores: members see their own store regardless of status (so admins can edit drafts)
CREATE POLICY "stores_select_members"
  ON public.stores FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = stores.id AND user_id = auth.uid()
  ));

-- stores: only the creator can insert
CREATE POLICY "stores_insert_self"
  ON public.stores FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- stores: owners/admins/managers can update
CREATE POLICY "stores_update_admin"
  ON public.stores FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = stores.id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin', 'manager')
  ));

-- store_members: members of a store can see each other
CREATE POLICY "store_members_select_same_store"
  ON public.store_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.store_members AS sm
    WHERE sm.store_id = store_members.store_id AND sm.user_id = auth.uid()
  ));

-- store_members: public can see members marked visible_on_storefront for active stores
CREATE POLICY "store_members_select_public"
  ON public.store_members FOR SELECT
  USING (
    visible_on_storefront = true
    AND EXISTS (
      SELECT 1 FROM public.stores
      WHERE id = store_members.store_id AND status = 'active' AND deleted_at IS NULL
    )
  );

-- store_members: owners/admins can manage membership
CREATE POLICY "store_members_modify_admin"
  ON public.store_members FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.store_members AS sm
    WHERE sm.store_id = store_members.store_id
      AND sm.user_id = auth.uid()
      AND sm.role IN ('owner', 'admin')
  ));

-- store_invitations: only store admins see pending invites
CREATE POLICY "store_invitations_select_admin"
  ON public.store_invitations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.store_members AS sm
    WHERE sm.store_id = store_invitations.store_id
      AND sm.user_id = auth.uid()
      AND sm.role IN ('owner', 'admin')
  ));

-- store_invitations: only owners/admins can create
CREATE POLICY "store_invitations_insert_admin"
  ON public.store_invitations FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.store_members AS sm
    WHERE sm.store_id = store_invitations.store_id
      AND sm.user_id = auth.uid()
      AND sm.role IN ('owner', 'admin')
  ));

-- Explicit grants (consistent with 0044)
GRANT SELECT ON public.stores TO anon, authenticated;
GRANT INSERT, UPDATE ON public.stores TO authenticated;
GRANT SELECT ON public.store_members TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.store_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.store_invitations TO authenticated;
