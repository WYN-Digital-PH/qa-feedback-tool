ALTER TABLE public.canvas_files
  ADD CONSTRAINT canvas_files_canvas_id_fkey
  FOREIGN KEY (canvas_id) REFERENCES public.canvases(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_canvas_files_canvas_id ON public.canvas_files(canvas_id);