-- =========================================================================
-- Four statuses, and "assigned" as a fact rather than a state
-- =========================================================================
--
-- `feedback_status` has carried eight values since the first migration, but
-- the product has never actually used eight. `20260504120216` already mapped
-- the data down to four — `in_review`, `assigned` and `changes_needed` to
-- `new`, `closed` to `resolved` — and then nothing removed the values, so the
-- pickers went on offering all eight and the board went on rendering columns
-- for statuses no workflow put anything into.
--
-- `20260825180000` then made it worse in a well-meaning way: a trigger that
-- flipped an item to `assigned` the moment somebody was put on it. That turns
-- one fact into two records of it. `assigned_to` already says who owns the
-- item; a status saying the same thing can disagree with it, and did — clear
-- the assignee and the status stayed `assigned`, describing a state the row no
-- longer had.
--
-- So: four statuses, enforced by the type rather than by convention, and
-- assignment derived from `assigned_to` wherever it is shown.
--
--     new          nobody has started
--     in_progress  someone is working on it
--     ready_for_qa the work is done and wants checking
--     resolved     signed off
--
-- Assigned / Unassigned is not among them. It is `assigned_to IS NOT NULL`,
-- computed at the point of display, and cannot be set by hand.

-- -------------------------------------------------------------------------
-- 1. Stop the trigger that writes the status being retired
-- -------------------------------------------------------------------------
--
-- Dropped before the data is mapped: while it exists, any UPDATE touching
-- `assigned_to` can put `assigned` back on a row that was just moved off it.

DROP TRIGGER IF EXISTS feedback_items_advance_status ON public.feedback_items;
DROP FUNCTION IF EXISTS public.advance_status_on_assign();

-- -------------------------------------------------------------------------
-- 2. Map the rows still holding a retired value
-- -------------------------------------------------------------------------
--
-- The same mapping `20260504120216` used. Everything that still needs a human
-- lands in `new`, so it is re-triaged deliberately instead of inheriting a
-- position on the board that nobody chose. `assigned_to` is untouched: the
-- assignee is not lost, it stops being duplicated as a status.

UPDATE public.feedback_items
SET status = 'new'
WHERE status IN ('in_review', 'assigned', 'changes_needed');

UPDATE public.feedback_items
SET status = 'resolved'
WHERE status = 'closed';

-- -------------------------------------------------------------------------
-- 3. Narrow the type
-- -------------------------------------------------------------------------
--
-- Postgres cannot remove a value from an enum, so the column is moved onto a
-- new type and the old one dropped. Doing it as a type swap rather than a
-- CHECK constraint means the generated TypeScript narrows too — the app's
-- `FeedbackStatus` union and the database agree by construction instead of by
-- somebody remembering to update both.
--
-- The default has to come off before the type changes and go back afterwards:
-- it is an expression of the old type and would block the ALTER.

CREATE TYPE public.feedback_status_v2 AS ENUM ('new', 'in_progress', 'ready_for_qa', 'resolved');

ALTER TABLE public.feedback_items ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.feedback_items
  ALTER COLUMN status TYPE public.feedback_status_v2
  USING status::text::public.feedback_status_v2;

ALTER TABLE public.feedback_items ALTER COLUMN status SET DEFAULT 'new';

DROP TYPE public.feedback_status;
ALTER TYPE public.feedback_status_v2 RENAME TO feedback_status;

-- -------------------------------------------------------------------------
-- 4. Sign-off is one status now
-- -------------------------------------------------------------------------
--
-- `closed` no longer exists, so the permission gate that named it would be
-- comparing against a value the type cannot hold. Recreated naming only
-- `resolved`, which is what `feedback.resolve` has always meant: the last
-- word on a fix, reserved for QA or a lead.

CREATE OR REPLACE FUNCTION public.enforce_feedback_update_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND NOT public.has_permission(auth.uid(), 'feedback.assign') THEN
    RAISE EXCEPTION 'Your role cannot assign feedback' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'resolved'
     AND NOT public.has_permission(auth.uid(), 'feedback.resolve') THEN
    RAISE EXCEPTION 'Your role cannot resolve feedback' USING ERRCODE = '42501';
  END IF;

  -- The app deletes feedback by stamping deleted_at rather than removing rows.
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     AND NOT public.has_permission(auth.uid(), 'feedback.delete') THEN
    RAISE EXCEPTION 'Your role cannot delete feedback' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- -------------------------------------------------------------------------
-- 5. Assignment still notifies, it just no longer rewrites the status
-- -------------------------------------------------------------------------
--
-- `20260825180000` gave assignment two effects: notify the assignee, and move
-- the item to `assigned`. Only the second is being removed. The notification
-- trigger is a separate function and is deliberately left alone — this
-- migration must not quietly stop the bell from ringing.

COMMENT ON COLUMN public.feedback_items.assigned_to IS
  'Who owns this item. The only source of Assigned / Unassigned — there is no status for it.';
