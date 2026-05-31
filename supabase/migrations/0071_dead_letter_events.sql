-- Dead-letter table for commerce-path failures that can't be rolled back
-- but shouldn't be silently swallowed. Anything money-touching that
-- catches an error MUST either throw to roll back the parent operation
-- or record a row here so support can audit + manually resolve.
--
-- See refactor.md item 16 and the CLAUDE.md "Commerce paths — no silent
-- failures" rule.

CREATE TABLE IF NOT EXISTS public.dead_letter_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),

  -- Which service + operation produced the event. e.g. 'commissions.acceptOffer'.
  service text NOT NULL,
  -- The user (if any) whose action triggered this. Helpful for support routing.
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The input that produced the failure (sanitised — no card numbers,
  -- no full PII unless minimal for resolution). Schema-less JSON so
  -- callers can put what's useful.
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Error message + optional stack-ish detail. Short — long traces
  -- belong in worker logs, not this table.
  error text NOT NULL,

  -- Resolution audit trail. Admin marks resolved with a note.
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_events_unresolved
  ON public.dead_letter_events(occurred_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dead_letter_events_service
  ON public.dead_letter_events(service, occurred_at DESC);

ALTER TABLE public.dead_letter_events ENABLE ROW LEVEL SECURITY;

-- Only admins/moderators read the table. No insert/update policy needed —
-- the service-role key writes (services use ctx.admin to record events).
CREATE POLICY "Staff read dead-letter events"
  ON public.dead_letter_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'moderator')
    )
  );

CREATE POLICY "Staff resolve dead-letter events"
  ON public.dead_letter_events FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'moderator')
    )
  );
