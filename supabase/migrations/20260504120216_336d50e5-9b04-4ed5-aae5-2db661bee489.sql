
-- 1. Add visibility column to feedback_items
ALTER TABLE public.feedback_items
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'internal'));

UPDATE public.feedback_items SET visibility = 'internal' WHERE is_internal = true;
CREATE INDEX IF NOT EXISTS idx_feedback_items_visibility ON public.feedback_items(visibility);

-- 2. Migrate data to a smaller status set (reuse existing enum values)
UPDATE public.feedback_items
SET status = 'new'
WHERE status IN ('in_review', 'assigned', 'changes_needed');

UPDATE public.feedback_items
SET status = 'resolved'
WHERE status = 'closed';

-- 3. Loosen INSERT RLS on management tables — any team member can create
DROP POLICY IF EXISTS "managers write clients" ON public.clients;
CREATE POLICY "team writes clients"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (is_team_member(auth.uid()));

DROP POLICY IF EXISTS "managers write projects" ON public.projects;
CREATE POLICY "team writes projects"
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (is_team_member(auth.uid()));

DROP POLICY IF EXISTS "managers write canvases" ON public.canvases;
CREATE POLICY "team writes canvases"
  ON public.canvases FOR INSERT TO authenticated
  WITH CHECK (is_team_member(auth.uid()));

DROP POLICY IF EXISTS "managers write canvas_files" ON public.canvas_files;
CREATE POLICY "team writes canvas_files"
  ON public.canvas_files FOR INSERT TO authenticated
  WITH CHECK (is_team_member(auth.uid()));
