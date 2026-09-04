-- ============================================================================
-- CUSTOMIZABLE ROLE PERMISSIONS
--
-- Before this migration, what a role could do was hardcoded across ~30 RLS
-- policies through three helpers (is_team_member / can_manage / has_role), with
-- three consequences:
--
--   * `viewer` was not read-only. A later migration opened INSERT on clients,
--     projects, canvases and canvas_files to every team member, so a viewer
--     could create an agency but not edit it.
--   * `developer` and `qa` carried no privileges of their own — they resolved
--     to exactly the same rights as `viewer`.
--   * Nothing could be adjusted per workspace without a code change.
--
-- Permissions now live in data: `permissions` is the catalogue, and
-- `role_permissions` is the per-role grant an owner can edit. RLS asks
-- `has_permission(uid, key)` instead of naming roles, so changing a checkbox in
-- Settings changes what the database itself allows.
--
-- Owners are deliberately excluded from customization: `has_permission` returns
-- true for them unconditionally and their rows are immutable, so a workspace
-- can never be locked out of its own settings.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Catalogue of every permission the app understands.
-- Code-managed: the UI reads it to render the matrix, nobody writes to it.
-- ---------------------------------------------------------------------------
CREATE TABLE public.permissions (
  key           TEXT PRIMARY KEY,
  category      TEXT NOT NULL,
  label         TEXT NOT NULL,
  description   TEXT NOT NULL,
  -- Permissions the app cannot function without are shown but locked in the UI.
  is_locked     BOOLEAN NOT NULL DEFAULT false,
  sort_order    INTEGER NOT NULL
);
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

INSERT INTO public.permissions (key, category, label, description, is_locked, sort_order) VALUES
  ('clients.view',    'Agencies', 'View agencies',        'See the agency list and agency details.',                                   false, 10),
  ('clients.create',  'Agencies', 'Create agencies',      'Add a new agency to the workspace.',                                        false, 11),
  ('clients.update',  'Agencies', 'Edit agencies',        'Change agency details such as contact, website or notes.',                  false, 12),
  ('clients.delete',  'Agencies', 'Delete agencies',      'Permanently remove an agency and everything filed under it.',               false, 13),

  ('projects.view',   'Projects', 'View projects',        'See the project list and project details.',                                 false, 20),
  ('projects.create', 'Projects', 'Create projects',      'Start a new project for an agency.',                                        false, 21),
  ('projects.update', 'Projects', 'Edit projects',        'Rename a project or change its status.',                                    false, 22),
  ('projects.delete', 'Projects', 'Delete projects',      'Permanently remove a project and its canvases.',                            false, 23),

  ('canvases.view',   'Canvases', 'View canvases',        'Open review canvases and their share links.',                               false, 30),
  ('canvases.create', 'Canvases', 'Create canvases',      'Add a website, image or PDF canvas and generate its review link.',          false, 31),
  ('canvases.update', 'Canvases', 'Edit canvases',        'Change canvas settings, pause or resume client commenting.',                false, 32),
  ('canvases.delete', 'Canvases', 'Delete canvases',      'Permanently remove a canvas along with its feedback.',                      false, 33),

  ('feedback.view',    'Feedback', 'View feedback',       'Read client feedback, replies and internal notes.',                         false, 40),
  ('feedback.comment', 'Feedback', 'Comment and pin',     'Reply to feedback, add internal notes, and drop team pins on a canvas.',    false, 41),
  ('feedback.triage',  'Feedback', 'Triage feedback',     'Change status, priority, category and labels on a feedback item.',          false, 42),
  ('feedback.assign',  'Feedback', 'Assign feedback',     'Assign a feedback item to a team member.',                                  false, 43),
  ('feedback.resolve', 'Feedback', 'Resolve and close',   'Mark feedback resolved or closed — the final sign-off on a fix.',           false, 44),
  ('feedback.delete',  'Feedback', 'Delete feedback',     'Delete feedback items and replies.',                                        false, 45),

  ('labels.manage',   'Workspace', 'Manage labels',       'Create, rename, recolour and delete the shared label set.',                 false, 50),
  ('team.manage',     'Workspace', 'Manage team',         'Invite people, revoke invites and change member roles.',                    false, 51);

-- ---------------------------------------------------------------------------
-- Per-role grants. One row per (role, permission); owners are seeded for
-- display but are always allowed regardless of what the row says.
-- ---------------------------------------------------------------------------
CREATE TABLE public.role_permissions (
  role        public.app_role NOT NULL,
  permission  TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  allowed     BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES auth.users(id),
  PRIMARY KEY (role, permission)
);
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_role_permissions_lookup ON public.role_permissions(role, permission) WHERE allowed;

-- ---------------------------------------------------------------------------
-- Defaults. Also the target of "Reset to defaults" in Settings, which is why
-- they live in a function rather than a one-off INSERT.
--
--   owner       everything, always
--   admin       everything except changing these permissions
--   consultant  runs client work end to end, but cannot delete records
--   developer   works items and moves them to Ready for QA; cannot sign off
--   qa          works items and owns the final resolve/close
--   viewer      read-only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.default_role_permissions()
RETURNS TABLE (role public.app_role, permission TEXT, allowed BOOLEAN)
LANGUAGE sql
STABLE
AS $$
  WITH grants(role, keys) AS (
    VALUES
      ('owner'::public.app_role, ARRAY[
        'clients.view','clients.create','clients.update','clients.delete',
        'projects.view','projects.create','projects.update','projects.delete',
        'canvases.view','canvases.create','canvases.update','canvases.delete',
        'feedback.view','feedback.comment','feedback.triage','feedback.assign','feedback.resolve','feedback.delete',
        'labels.manage','team.manage']),
      ('admin'::public.app_role, ARRAY[
        'clients.view','clients.create','clients.update','clients.delete',
        'projects.view','projects.create','projects.update','projects.delete',
        'canvases.view','canvases.create','canvases.update','canvases.delete',
        'feedback.view','feedback.comment','feedback.triage','feedback.assign','feedback.resolve','feedback.delete',
        'labels.manage','team.manage']),
      ('consultant'::public.app_role, ARRAY[
        'clients.view','clients.create','clients.update',
        'projects.view','projects.create','projects.update',
        'canvases.view','canvases.create','canvases.update',
        'feedback.view','feedback.comment','feedback.triage','feedback.assign','feedback.resolve',
        'labels.manage']),
      ('developer'::public.app_role, ARRAY[
        'clients.view','projects.view','canvases.view',
        'feedback.view','feedback.comment','feedback.triage']),
      ('qa'::public.app_role, ARRAY[
        'clients.view','projects.view','canvases.view',
        'feedback.view','feedback.comment','feedback.triage','feedback.assign','feedback.resolve',
        'labels.manage']),
      ('viewer'::public.app_role, ARRAY[
        'clients.view','projects.view','canvases.view','feedback.view'])
  )
  SELECT g.role, p.key, (p.key = ANY (g.keys))
  FROM grants g
  CROSS JOIN public.permissions p;
$$;

REVOKE ALL ON FUNCTION public.default_role_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.default_role_permissions() TO authenticated, service_role;

INSERT INTO public.role_permissions (role, permission, allowed)
SELECT role, permission, allowed FROM public.default_role_permissions();

-- ---------------------------------------------------------------------------
-- The single question every policy asks.
--
-- Like has_role(), it only answers about the calling user: a signed-in member
-- must not be able to probe what other roles can do through this function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR _user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND (
          ur.role = 'owner'
          OR EXISTS (
            SELECT 1 FROM public.role_permissions rp
            WHERE rp.role = ur.role
              AND rp.permission = _permission
              AND rp.allowed
          )
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, service_role;

-- The signed-in user's own permission keys, for the app to gate its UI with.
CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS SETOF TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.key
  FROM public.user_roles ur
  CROSS JOIN public.permissions p
  WHERE ur.user_id = auth.uid()
    AND (
      ur.role = 'owner'
      OR EXISTS (
        SELECT 1 FROM public.role_permissions rp
        WHERE rp.role = ur.role AND rp.permission = p.key AND rp.allowed
      )
    );
$$;

REVOKE ALL ON FUNCTION public.my_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_permissions() TO authenticated;

-- Same question, asked about someone else. Edge functions run with the service
-- role and no auth.uid(), so has_permission() would always answer false for
-- them; this variant drops the self-check and is granted to service_role only.
CREATE OR REPLACE FUNCTION public.user_has_permission(_user_id UUID, _permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.role = 'owner'
        OR EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role = ur.role
            AND rp.permission = _permission
            AND rp.allowed
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_permission(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Owner rows are not editable — a workspace must never be able to lock itself
-- out of Settings. Created after the seed so the seed itself can run.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_owner_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      RAISE EXCEPTION 'Owner permissions cannot be changed' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.role = 'owner' AND NOT NEW.allowed THEN
    RAISE EXCEPTION 'Owner permissions cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER role_permissions_protect_owner
  BEFORE INSERT OR UPDATE OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.protect_owner_permissions();

CREATE OR REPLACE FUNCTION public.touch_role_permission()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER role_permissions_touch
  BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_role_permission();

-- ---------------------------------------------------------------------------
-- RLS for the new tables.
-- Everyone signed in with a role can read them (the UI needs the catalogue to
-- decide what to show); only owners may change a grant.
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.permissions, public.role_permissions TO service_role;

CREATE POLICY "team reads permission catalogue" ON public.permissions
  FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));

CREATE POLICY "team reads role permissions" ON public.role_permissions
  FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));

CREATE POLICY "owners change role permissions" ON public.role_permissions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "owners restore role permissions" ON public.role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

-- ============================================================================
-- POLICY REWRITE — every rule below now reads from role_permissions.
-- ============================================================================

-- ----------------------------------------------------------------- clients --
DROP POLICY IF EXISTS "team reads clients"     ON public.clients;
DROP POLICY IF EXISTS "team writes clients"    ON public.clients;
DROP POLICY IF EXISTS "managers write clients" ON public.clients;
DROP POLICY IF EXISTS "managers update clients" ON public.clients;
DROP POLICY IF EXISTS "managers delete clients" ON public.clients;

CREATE POLICY "read clients" ON public.clients
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'clients.view'));
CREATE POLICY "create clients" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(), 'clients.create'));
CREATE POLICY "update clients" ON public.clients
  FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(), 'clients.update'));
CREATE POLICY "delete clients" ON public.clients
  FOR DELETE TO authenticated USING (public.has_permission(auth.uid(), 'clients.delete'));

-- ---------------------------------------------------------------- projects --
DROP POLICY IF EXISTS "team reads projects"      ON public.projects;
DROP POLICY IF EXISTS "team writes projects"     ON public.projects;
DROP POLICY IF EXISTS "managers write projects"  ON public.projects;
DROP POLICY IF EXISTS "managers update projects" ON public.projects;
DROP POLICY IF EXISTS "managers delete projects" ON public.projects;

CREATE POLICY "read projects" ON public.projects
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'projects.view'));
CREATE POLICY "create projects" ON public.projects
  FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(), 'projects.create'));
CREATE POLICY "update projects" ON public.projects
  FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(), 'projects.update'));
CREATE POLICY "delete projects" ON public.projects
  FOR DELETE TO authenticated USING (public.has_permission(auth.uid(), 'projects.delete'));

-- ---------------------------------------------------------------- canvases --
DROP POLICY IF EXISTS "team reads canvases"      ON public.canvases;
DROP POLICY IF EXISTS "team writes canvases"     ON public.canvases;
DROP POLICY IF EXISTS "managers write canvases"  ON public.canvases;
DROP POLICY IF EXISTS "managers update canvases" ON public.canvases;
DROP POLICY IF EXISTS "managers delete canvases" ON public.canvases;

CREATE POLICY "read canvases" ON public.canvases
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'canvases.view'));
CREATE POLICY "create canvases" ON public.canvases
  FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(), 'canvases.create'));
CREATE POLICY "update canvases" ON public.canvases
  FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(), 'canvases.update'));
CREATE POLICY "delete canvases" ON public.canvases
  FOR DELETE TO authenticated USING (public.has_permission(auth.uid(), 'canvases.delete'));

-- ------------------------------------------------------------ canvas_files --
DROP POLICY IF EXISTS "team reads canvas_files"      ON public.canvas_files;
DROP POLICY IF EXISTS "team writes canvas_files"     ON public.canvas_files;
DROP POLICY IF EXISTS "managers write canvas_files"  ON public.canvas_files;
DROP POLICY IF EXISTS "managers update canvas_files" ON public.canvas_files;
DROP POLICY IF EXISTS "managers delete canvas_files" ON public.canvas_files;

CREATE POLICY "read canvas files" ON public.canvas_files
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'canvases.view'));
CREATE POLICY "create canvas files" ON public.canvas_files
  FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(), 'canvases.create'));
CREATE POLICY "update canvas files" ON public.canvas_files
  FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(), 'canvases.update'));
CREATE POLICY "delete canvas files" ON public.canvas_files
  FOR DELETE TO authenticated USING (public.has_permission(auth.uid(), 'canvases.delete'));

-- ------------------------------------------------------------------ labels --
DROP POLICY IF EXISTS "team reads labels"     ON public.labels;
DROP POLICY IF EXISTS "managers write labels" ON public.labels;
DROP POLICY IF EXISTS "managers update labels" ON public.labels;
DROP POLICY IF EXISTS "admins delete labels"  ON public.labels;

CREATE POLICY "read labels" ON public.labels
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'feedback.view'));
CREATE POLICY "create labels" ON public.labels
  FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(), 'labels.manage'));
CREATE POLICY "update labels" ON public.labels
  FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(), 'labels.manage'));
CREATE POLICY "delete labels" ON public.labels
  FOR DELETE TO authenticated USING (public.has_permission(auth.uid(), 'labels.manage'));

-- --------------------------------------------------------- feedback_labels --
DROP POLICY IF EXISTS "team reads feedback_labels"   ON public.feedback_labels;
DROP POLICY IF EXISTS "team writes feedback_labels"  ON public.feedback_labels;
DROP POLICY IF EXISTS "team deletes feedback_labels" ON public.feedback_labels;

CREATE POLICY "read feedback labels" ON public.feedback_labels
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'feedback.view'));
CREATE POLICY "attach feedback labels" ON public.feedback_labels
  FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(), 'feedback.triage'));
CREATE POLICY "detach feedback labels" ON public.feedback_labels
  FOR DELETE TO authenticated USING (public.has_permission(auth.uid(), 'feedback.triage'));

-- ---------------------------------------------------------- feedback_items --
DROP POLICY IF EXISTS "team reads feedback"      ON public.feedback_items;
DROP POLICY IF EXISTS "team writes feedback"     ON public.feedback_items;
DROP POLICY IF EXISTS "team updates feedback"    ON public.feedback_items;
DROP POLICY IF EXISTS "managers delete feedback" ON public.feedback_items;

CREATE POLICY "read feedback" ON public.feedback_items
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'feedback.view'));
CREATE POLICY "create feedback" ON public.feedback_items
  FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(), 'feedback.comment'));
CREATE POLICY "update feedback" ON public.feedback_items
  FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(), 'feedback.triage'));
CREATE POLICY "delete feedback" ON public.feedback_items
  FOR DELETE TO authenticated USING (public.has_permission(auth.uid(), 'feedback.delete'));

-- ------------------------------------------------------- feedback_comments --
DROP POLICY IF EXISTS "team reads comments"      ON public.feedback_comments;
DROP POLICY IF EXISTS "team writes comments"     ON public.feedback_comments;
DROP POLICY IF EXISTS "team updates comments"    ON public.feedback_comments;
DROP POLICY IF EXISTS "managers delete comments" ON public.feedback_comments;

CREATE POLICY "read comments" ON public.feedback_comments
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'feedback.view'));
CREATE POLICY "create comments" ON public.feedback_comments
  FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(), 'feedback.comment'));
CREATE POLICY "update comments" ON public.feedback_comments
  FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(), 'feedback.comment'));
CREATE POLICY "delete comments" ON public.feedback_comments
  FOR DELETE TO authenticated USING (public.has_permission(auth.uid(), 'feedback.delete'));

-- ----------------------------------------------------------- review_decisions
DROP POLICY IF EXISTS "team reads decisions" ON public.review_decisions;
CREATE POLICY "read decisions" ON public.review_decisions
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'feedback.view'));

-- ------------------------------------------------------------- invitations --
DROP POLICY IF EXISTS "managers read invitations"   ON public.invitations;
DROP POLICY IF EXISTS "managers create invitations" ON public.invitations;
DROP POLICY IF EXISTS "managers update invitations" ON public.invitations;
DROP POLICY IF EXISTS "owners delete invitations"   ON public.invitations;

CREATE POLICY "read invitations" ON public.invitations
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'team.manage'));
-- Only an owner may invite another owner, whatever team.manage says.
CREATE POLICY "create invitations" ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'owner')
    OR (public.has_permission(auth.uid(), 'team.manage') AND role <> 'owner')
  );
CREATE POLICY "update invitations" ON public.invitations
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner')
    OR (public.has_permission(auth.uid(), 'team.manage') AND role <> 'owner')
  );
CREATE POLICY "delete invitations" ON public.invitations
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'owner'));

-- -------------------------------------------------------------- user_roles --
-- Role assignment follows team.manage, but granting or removing `owner` stays
-- an owner-only action so the permission cannot be used to escalate.
DROP POLICY IF EXISTS "admins manage non-owner roles" ON public.user_roles;
DROP POLICY IF EXISTS "admins delete non-owner roles" ON public.user_roles;

CREATE POLICY "managers assign non-owner roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'team.manage') AND role <> 'owner');

CREATE POLICY "managers remove non-owner roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'team.manage') AND role <> 'owner');

-- ============================================================================
-- COLUMN-LEVEL RULES
--
-- `feedback.assign`, `feedback.resolve` and `feedback.delete` restrict which
-- columns an UPDATE may touch, which a row policy cannot express (WITH CHECK
-- sees only the new row, never what changed). A trigger compares OLD to NEW.
--
-- auth.uid() is NULL for edge functions running with the service role — guest
-- submissions and screenshot callbacks — which bypass RLS by design.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_feedback_update_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND NOT public.has_permission(auth.uid(), 'feedback.assign') THEN
    RAISE EXCEPTION 'Your role cannot assign feedback' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('resolved', 'closed')
     AND NOT public.has_permission(auth.uid(), 'feedback.resolve') THEN
    RAISE EXCEPTION 'Your role cannot resolve or close feedback' USING ERRCODE = '42501';
  END IF;

  -- The app deletes feedback by stamping deleted_at rather than removing rows.
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     AND NOT public.has_permission(auth.uid(), 'feedback.delete') THEN
    RAISE EXCEPTION 'Your role cannot delete feedback' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_items_enforce_permissions
  BEFORE UPDATE ON public.feedback_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feedback_update_permissions();

CREATE OR REPLACE FUNCTION public.enforce_comment_update_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     AND NOT public.has_permission(auth.uid(), 'feedback.delete') THEN
    RAISE EXCEPTION 'Your role cannot delete replies' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_comments_enforce_permissions
  BEFORE UPDATE ON public.feedback_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_comment_update_permissions();

-- Trigger-only functions must not be callable from the API.
REVOKE ALL ON FUNCTION public.protect_owner_permissions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_role_permission() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_feedback_update_permissions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_comment_update_permissions() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- STORAGE — canvas file uploads follow the canvas permissions.
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated team can upload canvas files"    ON storage.objects;
DROP POLICY IF EXISTS "Authenticated managers can update canvas files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete canvas files"                 ON storage.objects;

CREATE POLICY "upload canvas files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'canvas-files' AND public.has_permission(auth.uid(), 'canvases.create'));

CREATE POLICY "update canvas files storage" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'canvas-files' AND public.has_permission(auth.uid(), 'canvases.update'));

CREATE POLICY "delete canvas files storage" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'canvas-files' AND public.has_permission(auth.uid(), 'canvases.delete'));
