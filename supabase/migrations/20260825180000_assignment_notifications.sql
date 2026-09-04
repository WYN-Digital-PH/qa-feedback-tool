-- =========================================================================
-- Assignment: tell the assignee, and move the item off "New"
-- =========================================================================
--
-- Two problems, both of which have to be solved in the database rather than in
-- a screen, because feedback is assigned from three different places (the
-- Feedback inbox, the review sidebar and the internal canvas):
--
--   1. Assigning work to someone told them nothing. The notification bell is
--      derived from recent guest activity, which is the same for everyone —
--      there was nowhere for a message addressed to one person to live.
--
--   2. An item assigned to someone kept the status `new`, so the inbox's
--      default "Active" view showed assigned work as untriaged and the board's
--      New column never drained.

-- -------------------------------------------------------------------------
-- 1. Per-user notifications
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  feedback_item_id UUID REFERENCES public.feedback_items(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  /** Who caused it. Kept so the row survives that account being deleted. */
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- A notification is addressed to exactly one person, and only that person may
-- see it — this is not a team feed, and the body quotes feedback content.
DROP POLICY IF EXISTS "read own notifications" ON public.notifications;
CREATE POLICY "read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Marking read is the only edit anyone makes. `WITH CHECK` keeps a row from
-- being reassigned to somebody else on the way through.
DROP POLICY IF EXISTS "mark own notifications read" ON public.notifications;
CREATE POLICY "mark own notifications read" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "dismiss own notifications" ON public.notifications;
CREATE POLICY "dismiss own notifications" ON public.notifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Deliberately no INSERT policy: rows are written only by the SECURITY DEFINER
-- trigger below, so nobody can put words in someone else's bell. Supabase
-- grants new public tables to anon and authenticated by default, so take that
-- back first rather than leaving RLS as the only thing standing in the way.
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

-- -------------------------------------------------------------------------
-- 2. Assigning an item notifies the assignee
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_feedback_assignee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous UUID := NULL;
  actor UUID := auth.uid();
  actor_name TEXT;
BEGIN
  -- OLD is not assigned on INSERT, so it can only be read under this branch.
  IF TG_OP = 'UPDATE' THEN
    previous := OLD.assigned_to;
  END IF;

  IF NEW.assigned_to IS NULL OR NEW.assigned_to IS NOT DISTINCT FROM previous THEN
    RETURN NEW;
  END IF;

  -- Picking something up yourself doesn't need announcing back to you.
  IF actor IS NOT NULL AND NEW.assigned_to = actor THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.full_name, p.email, 'Someone') INTO actor_name
  FROM public.profiles p WHERE p.id = actor;

  INSERT INTO public.notifications (user_id, kind, title, body, feedback_item_id, project_id, actor_id)
  VALUES (
    NEW.assigned_to,
    'feedback_assigned',
    COALESCE(actor_name, 'Someone') || ' assigned feedback to you',
    left(NEW.comment, 200),
    NEW.id,
    NEW.project_id,
    actor
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_feedback_assignee() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS feedback_items_notify_assignee ON public.feedback_items;
CREATE TRIGGER feedback_items_notify_assignee
  AFTER INSERT OR UPDATE OF assigned_to ON public.feedback_items
  FOR EACH ROW EXECUTE FUNCTION public.notify_feedback_assignee();

-- -------------------------------------------------------------------------
-- 3. Assigning an item moves it off "New"
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.advance_status_on_assign()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only when this update is what put someone on it...
  IF NEW.assigned_to IS NULL OR NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NEW;
  END IF;

  -- ...and only from a status that means "nobody has picked this up". An
  -- explicit status in the same update wins: someone assigning and setting
  -- "In progress" at once meant the second thing.
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND OLD.status IN ('new', 'in_review') THEN
    NEW.status := 'assigned';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_status_on_assign() FROM PUBLIC, anon, authenticated;

-- Named to sort before `feedback_items_enforce_permissions`, so the permission
-- check sees the status this leaves behind rather than the one it replaced.
DROP TRIGGER IF EXISTS feedback_items_advance_status ON public.feedback_items;
CREATE TRIGGER feedback_items_advance_status
  BEFORE UPDATE OF assigned_to ON public.feedback_items
  FOR EACH ROW EXECUTE FUNCTION public.advance_status_on_assign();

-- Existing rows that were assigned before this trigger existed.
UPDATE public.feedback_items
SET status = 'assigned'
WHERE assigned_to IS NOT NULL
  AND status = 'new'
  AND deleted_at IS NULL;

-- -------------------------------------------------------------------------
-- 4. Realtime, so the bell rings without a refresh
-- -------------------------------------------------------------------------

ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END;
$$;
