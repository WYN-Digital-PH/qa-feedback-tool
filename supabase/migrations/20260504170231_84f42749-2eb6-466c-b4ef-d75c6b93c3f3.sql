
ALTER TABLE public.feedback_items
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by_type text;

ALTER TABLE public.feedback_comments
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by_type text;

CREATE INDEX IF NOT EXISTS idx_feedback_items_deleted_at ON public.feedback_items (deleted_at);
CREATE INDEX IF NOT EXISTS idx_feedback_comments_deleted_at ON public.feedback_comments (deleted_at);
