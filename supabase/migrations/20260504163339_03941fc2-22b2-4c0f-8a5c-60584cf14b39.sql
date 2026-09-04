
-- Add guest ownership token to feedback items + comments so reviewers can edit/delete their own.
ALTER TABLE public.feedback_items ADD COLUMN IF NOT EXISTS guest_token uuid;
ALTER TABLE public.feedback_comments ADD COLUMN IF NOT EXISTS guest_token uuid;

CREATE INDEX IF NOT EXISTS idx_feedback_items_guest_token ON public.feedback_items(guest_token) WHERE guest_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_feedback_comments_guest_token ON public.feedback_comments(guest_token) WHERE guest_token IS NOT NULL;

-- Make sure realtime is enabled (idempotent attempts)
ALTER TABLE public.feedback_items REPLICA IDENTITY FULL;
ALTER TABLE public.feedback_comments REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.feedback_items';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.feedback_comments';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
