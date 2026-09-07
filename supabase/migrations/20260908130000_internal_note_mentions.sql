-- =========================================================================
-- Mentioning a teammate in an internal note
-- =========================================================================
--
-- A mention is stored in the body as `@[<user id>]`, never as the name that
-- was typed, so it re-renders correctly after somebody changes their display
-- name. See `src/lib/mentions.ts`.
--
-- The token pattern is the full uuid shape, not 36 loose characters: a sloppy
-- class matches 36 dashes, and the `::uuid` cast on that raises -- which would
-- fail the INSERT of the note itself, not merely the notification.
--
-- Notifications keep the rule set by `20260825180000`: rows are written only
-- by a SECURITY DEFINER trigger and there is no INSERT policy, so nobody can
-- put words in someone else's bell by posting to the table directly.

-- -------------------------------------------------------------------------
-- 1. Turning stored mentions back into prose
-- -------------------------------------------------------------------------
-- Used for the notification body. Without it the bell would read
-- "@[4b6b3f1e-...] can you look at this".

CREATE OR REPLACE FUNCTION public.render_mentions(_body TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out_text TEXT := COALESCE(_body, '');
  token TEXT;
  mentioned UUID;
  display TEXT;
BEGIN
  FOR token, mentioned IN
    SELECT m[1], m[1]::uuid
    FROM regexp_matches(out_text, '@\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]', 'g') AS m
  LOOP
    SELECT COALESCE(p.full_name, p.email, 'someone') INTO display
    FROM public.profiles p WHERE p.id = mentioned;

    out_text := replace(out_text, '@[' || token || ']', '@' || COALESCE(display, 'someone'));
  END LOOP;

  RETURN out_text;
END;
$$;

REVOKE ALL ON FUNCTION public.render_mentions(TEXT) FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 2. A mention notifies the person named
-- -------------------------------------------------------------------------

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
    CONTINUE WHEN NOT public.is_team_member(mentioned);

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

DROP TRIGGER IF EXISTS feedback_comments_notify_mentions ON public.feedback_comments;
CREATE TRIGGER feedback_comments_notify_mentions
  AFTER INSERT OR UPDATE OF body ON public.feedback_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_comment_mentions();
