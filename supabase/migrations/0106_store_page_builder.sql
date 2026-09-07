-- Store page-builder + theming (Phase 1).
--
-- Adds two nullable jsonb columns to `stores` (theme + page_config) and a
-- `store_assets` table for uploaded storefront images. NULL theme/page_config
-- means "use the platform-default storefront", so existing stores keep working
-- unchanged. Additive + backward-compatible.

-- 1) Storefront theme + block layout, as sanitised JSON.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS theme jsonb,
  ADD COLUMN IF NOT EXISTS page_config jsonb;

COMMENT ON COLUMN public.stores.theme IS
  'Sanitised store theme (colours + font ids). NULL = platform default. Written only via the store-page service; always re-sanitised on render.';
COMMENT ON COLUMN public.stores.page_config IS
  'Sanitised page-builder config: { blocks: [{ id, type, layout, props }] }. NULL = default storefront.';

-- theme/page_config writes are covered by the EXISTING stores_update_admin
-- policy (0046): only members with role owner/admin/manager may UPDATE a store,
-- and (with no separate WITH CHECK) that USING predicate also gates the new row,
-- so a non-member cannot set another store's theme via direct PostgREST.

-- 2) Store assets: uploaded storefront images (logo/banner/gallery).
CREATE TABLE IF NOT EXISTS public.store_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  path text NOT NULL,
  kind text,
  alt text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.store_assets IS 'Uploaded storefront images for the page-builder. Files live in the projects bucket under the uploader''s uid folder.';

CREATE INDEX IF NOT EXISTS idx_store_assets_store_position
  ON public.store_assets(store_id, position);

ALTER TABLE public.store_assets ENABLE ROW LEVEL SECURITY;

-- SELECT: readable to anyone who can read the parent store — i.e. the store is
-- publicly active, OR the requester is a member (mirrors the two stores read
-- policies, so preview works for members of a not-yet-active store).
CREATE POLICY "store_assets_select_public_active"
  ON public.store_assets FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = store_assets.store_id
      AND s.status = 'active'
      AND s.deleted_at IS NULL
  ));

CREATE POLICY "store_assets_select_members"
  ON public.store_assets FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.store_members sm
    WHERE sm.store_id = store_assets.store_id
      AND sm.user_id = auth.uid()
  ));

-- INSERT: only store editors (manager+). Column-pinned WITH CHECK ensures the
-- NEW row's store_id is one the caller manages — a member can't insert an asset
-- attributed to a store they don't manage.
CREATE POLICY "store_assets_insert_editor"
  ON public.store_assets FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.store_members sm
    WHERE sm.store_id = store_assets.store_id
      AND sm.user_id = auth.uid()
      AND sm.role IN ('owner', 'admin', 'manager')
  ));

-- UPDATE: editors only, and the row must STILL belong to a store they manage
-- after the update (USING gates the old row, WITH CHECK the new one) so an
-- asset can't be re-homed to another store.
CREATE POLICY "store_assets_update_editor"
  ON public.store_assets FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.store_members sm
    WHERE sm.store_id = store_assets.store_id
      AND sm.user_id = auth.uid()
      AND sm.role IN ('owner', 'admin', 'manager')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.store_members sm
    WHERE sm.store_id = store_assets.store_id
      AND sm.user_id = auth.uid()
      AND sm.role IN ('owner', 'admin', 'manager')
  ));

-- DELETE: editors only.
CREATE POLICY "store_assets_delete_editor"
  ON public.store_assets FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.store_members sm
    WHERE sm.store_id = store_assets.store_id
      AND sm.user_id = auth.uid()
      AND sm.role IN ('owner', 'admin', 'manager')
  ));

-- Explicit grants (consistent with 0046). Service role already has ALL via 0085.
GRANT SELECT ON public.store_assets TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.store_assets TO authenticated;
