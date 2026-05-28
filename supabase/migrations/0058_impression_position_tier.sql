-- Ranking signal logging: position, tier, and click timestamp on impressions.
-- Position enables position-debiased CTR (Joachims 2002). Tier distinguishes
-- boost from highlight CTR. clicked_at lets us measure time-to-click later.

ALTER TABLE public.listing_impressions
  ADD COLUMN IF NOT EXISTS position smallint,
  ADD COLUMN IF NOT EXISTS tier text CHECK (tier IN ('boost', 'highlight')),
  ADD COLUMN IF NOT EXISTS clicked_at timestamptz;

-- Used by the click endpoint to flip the most recent impression for
-- a (viewer, listing) pair to clicked=true.
CREATE INDEX IF NOT EXISTS idx_impressions_recent_by_viewer_listing
  ON public.listing_impressions(viewer_id, listing_id, created_at DESC)
  WHERE viewer_id IS NOT NULL;

-- Anonymous click attribution falls back to (listing, created_at).
CREATE INDEX IF NOT EXISTS idx_impressions_recent_by_listing
  ON public.listing_impressions(listing_id, created_at DESC)
  WHERE viewer_id IS NULL;

-- Allow the click endpoint (running as the viewer) to update their own
-- impression rows. Service role still bypasses RLS for anonymous clicks.
CREATE POLICY "Viewers update own impressions" ON public.listing_impressions
  FOR UPDATE USING (auth.uid() = viewer_id)
  WITH CHECK (auth.uid() = viewer_id);
