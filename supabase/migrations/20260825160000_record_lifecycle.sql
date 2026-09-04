-- =========================================================================
-- Record lifecycle: make archiving and deletion actually work
-- =========================================================================
--
-- `clients.delete`, `projects.delete` and `canvases.delete` were already
-- granted and policed by RLS, but nothing in the app could reach them and the
-- schema could not honour them:
--
--   * `clients.delete` is documented as removing "every project, canvas and
--     piece of feedback filed under it". Three tables carry a `client_id` that
--     referenced `clients(id)` with no ON DELETE action. Deleting an agency
--     only worked by accident — the cascade from `projects` happened to clear
--     those rows before the NO ACTION check ran at end of statement. A canvas,
--     feedback item or decision whose `client_id` pointed somewhere other than
--     its project's client blocked the delete outright, with a foreign key
--     error the UI could not explain.
--
--   * `feedback_labels` was created with no foreign keys at all. Deleting a
--     feedback item or a label left junction rows behind pointing at nothing,
--     and the app already deletes both (bulk delete, and the label manager).
--
-- Archiving needs no new columns. `clients.archived` already exists, the
-- `canvas_status` enum already has an 'archived' member, and projects carry a
-- free-text `status` that the dashboard already filters on.

-- -------------------------------------------------------------------------
-- 1. Deleting an agency removes what belongs to it
-- -------------------------------------------------------------------------

ALTER TABLE public.canvases DROP CONSTRAINT IF EXISTS canvases_client_id_fkey;
ALTER TABLE public.canvases
  ADD CONSTRAINT canvases_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

ALTER TABLE public.feedback_items DROP CONSTRAINT IF EXISTS feedback_items_client_id_fkey;
ALTER TABLE public.feedback_items
  ADD CONSTRAINT feedback_items_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

ALTER TABLE public.review_decisions DROP CONSTRAINT IF EXISTS review_decisions_client_id_fkey;
ALTER TABLE public.review_decisions
  ADD CONSTRAINT review_decisions_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- -------------------------------------------------------------------------
-- 2. Label assignments follow the item and the label
-- -------------------------------------------------------------------------

-- Any orphans already accumulated would fail the constraint below.
DELETE FROM public.feedback_labels fl
WHERE NOT EXISTS (SELECT 1 FROM public.feedback_items fi WHERE fi.id = fl.feedback_item_id)
   OR NOT EXISTS (SELECT 1 FROM public.labels l WHERE l.id = fl.label_id);

ALTER TABLE public.feedback_labels DROP CONSTRAINT IF EXISTS feedback_labels_feedback_item_id_fkey;
ALTER TABLE public.feedback_labels
  ADD CONSTRAINT feedback_labels_feedback_item_id_fkey
  FOREIGN KEY (feedback_item_id) REFERENCES public.feedback_items(id) ON DELETE CASCADE;

ALTER TABLE public.feedback_labels DROP CONSTRAINT IF EXISTS feedback_labels_label_id_fkey;
ALTER TABLE public.feedback_labels
  ADD CONSTRAINT feedback_labels_label_id_fkey
  FOREIGN KEY (label_id) REFERENCES public.labels(id) ON DELETE CASCADE;

-- -------------------------------------------------------------------------
-- 3. Archiving a project is a status, like archiving a canvas
-- -------------------------------------------------------------------------
--
-- `projects.status` is free text with no constraint, and the dashboard counts
-- rows where it equals 'active'. Pin the vocabulary so 'archived' means the
-- same thing everywhere and a typo can't silently hide a project.

UPDATE public.projects SET status = 'active' WHERE status NOT IN ('active', 'archived', 'completed');

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_status_check CHECK (status IN ('active', 'archived', 'completed'));

COMMENT ON COLUMN public.projects.status IS
  'active | archived | completed. Archived projects are hidden from the default list; their canvases keep working.';

COMMENT ON COLUMN public.clients.archived IS
  'Archived agencies are hidden from the default list. Archiving is reversible; deleting is not.';

-- -------------------------------------------------------------------------
-- 4. Indexes for the list filters
-- -------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_clients_archived ON public.clients(archived);
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);
CREATE INDEX IF NOT EXISTS idx_canvases_status ON public.canvases(status);
