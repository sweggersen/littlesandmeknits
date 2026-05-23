-- Moderation: freeze listings + in-app moderator-to-owner threads.

ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'frozen';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'moderation_message';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'moderation_new_item';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'moderation_shadow_pending';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'achievement_unlocked';

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS frozen_reason text,
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz,
  ADD COLUMN IF NOT EXISTS frozen_by uuid,
  ADD COLUMN IF NOT EXISTS pre_freeze_status public.listing_status;

ALTER TYPE public.commission_request_status ADD VALUE IF NOT EXISTS 'frozen';

CREATE TABLE IF NOT EXISTS public.moderation_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS moderation_threads_recipient_idx
  ON public.moderation_threads(recipient_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS moderation_threads_target_idx
  ON public.moderation_threads(target_type, target_id);

CREATE TABLE IF NOT EXISTS public.moderation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.moderation_threads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_moderator boolean NOT NULL DEFAULT false,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS moderation_messages_thread_idx
  ON public.moderation_messages(thread_id, created_at);

ALTER TABLE public.moderation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS moderation_threads_read ON public.moderation_threads;
DROP POLICY IF EXISTS moderation_threads_insert ON public.moderation_threads;
DROP POLICY IF EXISTS moderation_threads_update ON public.moderation_threads;
DROP POLICY IF EXISTS moderation_messages_read ON public.moderation_messages;
DROP POLICY IF EXISTS moderation_messages_insert ON public.moderation_messages;
DROP POLICY IF EXISTS moderation_messages_update ON public.moderation_messages;
DROP TRIGGER IF EXISTS moderation_threads_set_updated_at ON public.moderation_threads;
DROP TRIGGER IF EXISTS moderation_messages_touch_thread ON public.moderation_messages;

-- Recipient or moderator can read threads.
CREATE POLICY moderation_threads_read ON public.moderation_threads
  FOR SELECT TO authenticated
  USING (
    recipient_id = (SELECT auth.uid())
    OR public.is_admin_or_moderator((SELECT auth.uid()))
  );

CREATE POLICY moderation_messages_read ON public.moderation_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.moderation_threads t
      WHERE t.id = thread_id
        AND (
          t.recipient_id = (SELECT auth.uid())
          OR public.is_admin_or_moderator((SELECT auth.uid()))
        )
    )
  );

-- Recipient can reply to open threads. Moderators always can.
CREATE POLICY moderation_messages_insert ON public.moderation_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.moderation_threads t
      WHERE t.id = thread_id
        AND t.status = 'open'
        AND (
          (t.recipient_id = (SELECT auth.uid()) AND is_moderator = false)
          OR (public.is_admin_or_moderator((SELECT auth.uid())) AND is_moderator = true)
        )
    )
  );

-- Moderators only insert threads (admin path uses service role anyway).
CREATE POLICY moderation_threads_insert ON public.moderation_threads
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_moderator((SELECT auth.uid())));

CREATE POLICY moderation_threads_update ON public.moderation_threads
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_moderator((SELECT auth.uid())))
  WITH CHECK (public.is_admin_or_moderator((SELECT auth.uid())));

-- Update read_at: recipient can mark moderator messages as read.
CREATE POLICY moderation_messages_update ON public.moderation_messages
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.moderation_threads t
      WHERE t.id = thread_id
        AND (
          t.recipient_id = (SELECT auth.uid())
          OR public.is_admin_or_moderator((SELECT auth.uid()))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.moderation_threads t
      WHERE t.id = thread_id
        AND (
          t.recipient_id = (SELECT auth.uid())
          OR public.is_admin_or_moderator((SELECT auth.uid()))
        )
    )
  );

CREATE TRIGGER moderation_threads_set_updated_at
  BEFORE UPDATE ON public.moderation_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- When a message is inserted, bump the parent thread's updated_at.
CREATE OR REPLACE FUNCTION public.touch_moderation_thread()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.moderation_threads SET updated_at = now() WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER moderation_messages_touch_thread
  AFTER INSERT ON public.moderation_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_moderation_thread();
