-- Add pending_review and rejected statuses to listing_status enum.
-- MUST run alone and commit before 0037.

ALTER TYPE public.listing_status ADD VALUE 'pending_review' AFTER 'draft';
ALTER TYPE public.listing_status ADD VALUE 'rejected' AFTER 'removed';
