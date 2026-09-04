ALTER TABLE public.feedback_items ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid;
ALTER TABLE public.feedback_comments ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid;