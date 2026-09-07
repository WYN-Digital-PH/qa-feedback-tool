-- =========================================================================
-- Mentions never notified: the wrong team check
-- =========================================================================
--
-- `notify_comment_mentions()` guarded each mention with
-- `is_team_member(mentioned)`. That helper does not answer "is this account on
-- the team" -- `20260729172424` narrowed it to answer only "is *the caller* on
-- the team":
--
--   WHEN auth.uid() IS NULL OR _user_id IS DISTINCT FROM auth.uid() THEN false
--
-- which is a deliberate guard against probing whether an arbitrary id belongs
-- to the workspace. Inside this trigger `auth.uid()` is the note's author and
-- `mentioned` is somebody else, so it returned false every time and the loop
-- skipped every mention. Everything else worked: the token was stored, the
-- regex matched, the trigger fired.
--
-- The membership test now reads `user_roles` directly. That is safe precisely
-- because it lives in a SECURITY DEFINER trigger that no client can call --
-- it does not reopen the enumeration vector `20260729172424` closed.
--
-- (`20260908140000` re-attached the trigger while this was being tracked down.
-- The trigger was in fact already attached; that migration was a harmless
-- no-op, not the fix.)

CREATE OR REPLACE FUNCTION public.notify_comment_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID := COALESCE(NEW.user_id, auth.uid());
  actor_name TEXT;
  already UUID[] := ARRAY[]::UUID[];
  mentioned UUID;
  item_project UUID;
BEGIN
  -- Only the team's own thread. A public reply is addressed to the client and
  -- carries no tokens, but check rather than trust that.
  IF NOT NEW.is_internal THEN
    RETURN NEW;
  END IF;

  -- On an edit, only the mentions this edit *added* are new news. Re-sending
  -- the rest would ring the bell again on every typo fix.
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(DISTINCT lower(m[1])::uuid), ARRAY[]::UUID[]) INTO already
    FROM regexp_matches(COALESCE(OLD.body, ''), '@\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]', 'g') AS m;
  END IF;

  SELECT COALESCE(p.full_name, p.email, 'Someone') INTO actor_name
  FROM public.profiles p WHERE p.id = actor;

  SELECT fi.project_id INTO item_project
  FROM public.feedback_items fi WHERE fi.id = NEW.feedback_item_id;

  FOR mentioned IN
    SELECT DISTINCT lower(m[1])::uuid
    FROM regexp_matches(COALESCE(NEW.body, ''), '@\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]', 'g') AS m
  LOOP
    CONTINUE WHEN mentioned = ANY(already);
    -- Naming yourself doesn't need announcing back to you.
    CONTINUE WHEN actor IS NOT NULL AND mentioned = actor;
    -- Only teammates. A stale or invented id must not create a notification,
    -- and a guest has no bell to ring.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.user_roles ur WHERE ur.user_id = mentioned
    );

    INSERT INTO public.notifications (user_id, kind, title, body, feedback_item_id, project_id, actor_id)
    VALUES (
      mentioned,
      'comment_mention',
      COALESCE(actor_name, 'Someone') || ' mentioned you in a note',
      left(public.render_mentions(NEW.body), 200),
      NEW.feedback_item_id,
      item_project,
      actor
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_comment_mentions() FROM PUBLIC, anon, authenticated;
