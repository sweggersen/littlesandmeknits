-- Allow 'store' as a valid moderation_queue item type.
ALTER TABLE public.moderation_queue
  DROP CONSTRAINT IF EXISTS moderation_queue_item_type_check;

ALTER TABLE public.moderation_queue
  ADD CONSTRAINT moderation_queue_item_type_check
  CHECK (item_type IN ('listing', 'commission_request', 'store'));
