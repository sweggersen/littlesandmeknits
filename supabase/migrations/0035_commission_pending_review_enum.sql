-- Add pending_review and rejected statuses to commission_request_status enum.
-- MUST run alone and commit before 0037.

ALTER TYPE public.commission_request_status ADD VALUE 'pending_review' BEFORE 'open';
ALTER TYPE public.commission_request_status ADD VALUE 'rejected' AFTER 'expired';
