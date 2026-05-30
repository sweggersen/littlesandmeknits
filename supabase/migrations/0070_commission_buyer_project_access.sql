-- Commission buyers can read the project linked to their oppdrag.
-- This lets the buyer see photos + progress logs while the knitter
-- works, without needing the knitter to manually mark the project as
-- publicly shared (public_slug).
--
-- The link is: projects.commission_offer_id → commission_offers.id,
-- and that offer's request must have buyer_id = auth.uid().
--
-- We mirror the policy on project_logs so the progress feed inherits
-- the same audience rules.

CREATE POLICY "Commission buyer reads linked project"
  ON public.projects
  FOR SELECT
  USING (
    commission_offer_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.commission_offers o
      JOIN public.commission_requests r ON r.awarded_offer_id = o.id
      WHERE o.id = projects.commission_offer_id
        AND r.buyer_id = auth.uid()
    )
  );

CREATE POLICY "Commission buyer reads logs of linked project"
  ON public.project_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.commission_offers o ON o.id = p.commission_offer_id
      JOIN public.commission_requests r ON r.awarded_offer_id = o.id
      WHERE p.id = project_logs.project_id
        AND r.buyer_id = auth.uid()
    )
  );
