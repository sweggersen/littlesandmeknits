-- Lets reporters opt out of being identified to moderators.
-- When anonymous=true, the moderation detail page shows "Anonym" and
-- disables the "ask reporter" mailto button. Internally we still store
-- reporter_id (so the same person can't spam multiple anonymous reports
-- on the same target), but it's not exposed to moderator UI.

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS anonymous boolean NOT NULL DEFAULT false;
