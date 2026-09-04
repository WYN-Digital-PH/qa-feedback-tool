-- Ensure canvas_type enum has image and pdf values
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'image' AND enumtypid = 'public.canvas_type'::regtype) THEN
    ALTER TYPE public.canvas_type ADD VALUE 'image';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pdf' AND enumtypid = 'public.canvas_type'::regtype) THEN
    ALTER TYPE public.canvas_type ADD VALUE 'pdf';
  END IF;
END$$;

-- LABELS
CREATE TABLE IF NOT EXISTS public.labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  description TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name)
);

ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team reads labels" ON public.labels FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "managers write labels" ON public.labels FOR INSERT TO authenticated WITH CHECK (public.can_manage(auth.uid()));
CREATE POLICY "managers update labels" ON public.labels FOR UPDATE TO authenticated USING (public.can_manage(auth.uid()));
CREATE POLICY "admins delete labels" ON public.labels FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER labels_updated_at BEFORE UPDATE ON public.labels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- FEEDBACK_LABELS (junction)
CREATE TABLE IF NOT EXISTS public.feedback_labels (
  feedback_item_id UUID NOT NULL,
  label_id UUID NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (feedback_item_id, label_id)
);

ALTER TABLE public.feedback_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team reads feedback_labels" ON public.feedback_labels FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "team writes feedback_labels" ON public.feedback_labels FOR INSERT TO authenticated WITH CHECK (public.is_team_member(auth.uid()));
CREATE POLICY "team deletes feedback_labels" ON public.feedback_labels FOR DELETE TO authenticated USING (public.is_team_member(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_feedback_labels_label ON public.feedback_labels(label_id);

-- CANVAS_FILES (image/pdf uploads)
CREATE TABLE IF NOT EXISTS public.canvas_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id UUID NOT NULL,
  storage_path TEXT NOT NULL,
  public_url TEXT,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  original_filename TEXT,
  page_count INTEGER,
  width INTEGER,
  height INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.canvas_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team reads canvas_files" ON public.canvas_files FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "managers write canvas_files" ON public.canvas_files FOR INSERT TO authenticated WITH CHECK (public.can_manage(auth.uid()));
CREATE POLICY "managers update canvas_files" ON public.canvas_files FOR UPDATE TO authenticated USING (public.can_manage(auth.uid()));
CREATE POLICY "managers delete canvas_files" ON public.canvas_files FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_canvas_files_canvas ON public.canvas_files(canvas_id);

-- STORAGE BUCKET for canvas files (public read so guest viewer can render image/pdf)
INSERT INTO storage.buckets (id, name, public)
VALUES ('canvas-files', 'canvas-files', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can read canvas files"
ON storage.objects FOR SELECT
USING (bucket_id = 'canvas-files');

CREATE POLICY "Authenticated team can upload canvas files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'canvas-files' AND public.is_team_member(auth.uid()));

CREATE POLICY "Authenticated managers can update canvas files"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'canvas-files' AND public.can_manage(auth.uid()));

CREATE POLICY "Admins can delete canvas files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'canvas-files' AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin')));

-- Seed default labels
INSERT INTO public.labels (name, color) VALUES
  ('Bug', '#ef4444'),
  ('Content', '#3b82f6'),
  ('Design', '#a855f7'),
  ('Mobile', '#06b6d4'),
  ('SEO', '#10b981'),
  ('Form', '#f59e0b'),
  ('Needs Review', '#eab308'),
  ('Client Request', '#0ea5e9'),
  ('Approved', '#22c55e'),
  ('Blocked', '#dc2626')
ON CONFLICT (name) DO NOTHING;