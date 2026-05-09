-- Add completion statuses for commissions.
-- MUST run alone and commit before 0024.

alter type public.commission_request_status add value 'completed' after 'awarded';
alter type public.commission_request_status add value 'delivered' after 'completed';
