-- Store page-builder DRAFT columns (Phase 2).
--
-- The interactive editor ("Butikk-lekeplass") writes to a DRAFT copy of the
-- storefront theme + page config; the public storefront keeps rendering the
-- LIVE `theme`/`page_config` until the owner clicks "Publiser", which copies
-- draft -> live. This way visitors never see a half-edited page.
--
-- Additive + backward-compatible: NULL draft means "no unpublished changes".

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS theme_draft jsonb,
  ADD COLUMN IF NOT EXISTS page_config_draft jsonb;

COMMENT ON COLUMN public.stores.theme_draft IS
  'Unpublished (draft) store theme edited in the Phase 2 editor. NULL = no draft. Copied to `theme` on publish; always re-sanitised by the store-page service on write and on publish.';
COMMENT ON COLUMN public.stores.page_config_draft IS
  'Unpublished (draft) page-builder config edited in the Phase 2 editor. NULL = no draft. Copied to `page_config` on publish; always re-sanitised.';

-- No new RLS needed: theme_draft / page_config_draft are columns on `stores`,
-- so writes are gated by the EXISTING stores_update_admin policy (0046) — only
-- members with role owner/admin/manager may UPDATE a store row, and that USING
-- predicate (with no separate WITH CHECK) also gates the new row. A non-member
-- therefore cannot set another store's draft via direct PostgREST, exactly as
-- for the live theme/page_config columns (see 0106).
