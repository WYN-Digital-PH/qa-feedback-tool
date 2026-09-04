-- =========================================================================
-- Closing a round of requested changes
-- =========================================================================
--
-- `review_decisions` was append-only, and the canvas card rendered every row
-- it held. That made a decision permanent in the UI: a client who once picked
-- "Request changes" left a warning on the project page for good. Resolving
-- every comment they raised did nothing, because a resolved comment and an
-- open change request were unrelated records — there was no way, anywhere in
-- the product, to say "we have dealt with this round".
--
-- The fix is not to delete decisions. What the client said happened, and the
-- history is worth keeping. What was missing is the *other half* of the
-- exchange: the team's acknowledgement. A round now carries who closed it and
-- when, so the card can show a current state ("changes requested" vs
-- "addressed, awaiting re-review") while the log below it stays complete.
--
-- Only the client can approve. Marking a round addressed says "we have done
-- the work", not "this is signed off" — the next approval still has to come
-- from the reviewer through the public link.

ALTER TABLE public.review_decisions
  ADD COLUMN IF NOT EXISTS addressed_at TIMESTAMPTZ,
  /** Kept as SET NULL so closing a round survives that account being deleted. */
  ADD COLUMN IF NOT EXISTS addressed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS addressed_note TEXT;

-- The project page asks for the open change requests on a set of canvases on
-- every render, so keep that lookup off a sequential scan.
CREATE INDEX IF NOT EXISTS idx_review_decisions_open_changes
  ON public.review_decisions (canvas_id)
  WHERE decision = 'changes_requested' AND addressed_at IS NULL;

-- -------------------------------------------------------------------------
-- Who may close a round
-- -------------------------------------------------------------------------
--
-- `feedback.resolve` already means "the final sign-off on a fix", which is
-- exactly this action at the level of a whole round. Reusing it keeps the
-- permission matrix from growing a key that would always be set alongside it.
--
-- The USING clause governs which rows may be touched; the WITH CHECK clause
-- governs what they may be turned into. Narrowing WITH CHECK to the three
-- acknowledgement columns is not possible in a policy, so the write path is
-- additionally constrained by a trigger below.
DROP POLICY IF EXISTS "close change requests" ON public.review_decisions;
CREATE POLICY "close change requests" ON public.review_decisions
  FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'feedback.resolve'))
  WITH CHECK (public.has_permission(auth.uid(), 'feedback.resolve'));

-- A decision is a record of what a client said. Acknowledging a round must not
-- become a way to rewrite it, so everything except the acknowledgement columns
-- is frozen against UPDATE — including for the service role.
CREATE OR REPLACE FUNCTION public.review_decisions_freeze_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.decision       IS DISTINCT FROM OLD.decision
  OR NEW.reviewer_name  IS DISTINCT FROM OLD.reviewer_name
  OR NEW.reviewer_email IS DISTINCT FROM OLD.reviewer_email
  OR NEW.message        IS DISTINCT FROM OLD.message
  OR NEW.canvas_id      IS DISTINCT FROM OLD.canvas_id
  OR NEW.project_id     IS DISTINCT FROM OLD.project_id
  OR NEW.created_at     IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A review decision is a record of what the reviewer said; only its acknowledgement may change.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS review_decisions_freeze_record ON public.review_decisions;
CREATE TRIGGER review_decisions_freeze_record
  BEFORE UPDATE ON public.review_decisions
  FOR EACH ROW EXECUTE FUNCTION public.review_decisions_freeze_record();

-- Stamp the actor and the time server-side, so a client cannot backdate a
-- round or attribute closing it to somebody else.
CREATE OR REPLACE FUNCTION public.review_decisions_stamp_addressed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.addressed_at IS NULL THEN
    -- Reopening a round: drop the attribution with it.
    NEW.addressed_by   := NULL;
    NEW.addressed_note := NULL;
  ELSIF OLD.addressed_at IS NULL THEN
    -- Closing it. The caller's value is only a signal that it meant to.
    NEW.addressed_at := now();
    NEW.addressed_by := COALESCE(auth.uid(), NEW.addressed_by);
  ELSE
    -- Already closed. Re-sending a different timestamp must not move it, or
    -- the stamp would be no more trustworthy than a client-supplied one.
    NEW.addressed_at := OLD.addressed_at;
    NEW.addressed_by := OLD.addressed_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS review_decisions_stamp_addressed ON public.review_decisions;
CREATE TRIGGER review_decisions_stamp_addressed
  BEFORE UPDATE ON public.review_decisions
  FOR EACH ROW EXECUTE FUNCTION public.review_decisions_stamp_addressed();
