ALTER TABLE public.feedback_items
  ADD COLUMN IF NOT EXISTS screenshot_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS screenshot_error text;