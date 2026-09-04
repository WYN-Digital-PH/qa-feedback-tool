
-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('owner','admin','consultant','developer','qa','viewer');
CREATE TYPE public.canvas_type AS ENUM ('website','image','pdf','screenshot');
CREATE TYPE public.canvas_status AS ENUM ('active','paused','completed','archived');
CREATE TYPE public.feedback_status AS ENUM ('new','in_review','assigned','in_progress','ready_for_qa','changes_needed','resolved','closed');
CREATE TYPE public.feedback_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE public.feedback_category AS ENUM ('general','design','content','bug','mobile','seo','form','performance','other');
CREATE TYPE public.review_decision_type AS ENUM ('approved','changes_requested');

-- =========================================================
-- HELPER: updated_at trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- =========================================================
-- PROFILES
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- USER ROLES (separate table per security best practice)
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_team_member(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.can_manage(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('owner','admin','consultant')
  );
$$;

-- =========================================================
-- SIGNUP TRIGGER -> create profile + assign role
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INT;
  assigned_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 THEN
    assigned_role := 'owner';
  ELSE
    assigned_role := 'viewer';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, assigned_role);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- CLIENTS
-- =========================================================
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company_name TEXT,
  email TEXT,
  phone TEXT,
  website_url TEXT,
  notes TEXT,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- PROJECTS
-- =========================================================
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- CANVASES
-- =========================================================
CREATE TABLE public.canvases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id),
  name TEXT NOT NULL,
  type public.canvas_type NOT NULL DEFAULT 'website',
  website_url TEXT,
  staging_url TEXT,
  file_url TEXT,
  public_key TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  share_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  status public.canvas_status NOT NULL DEFAULT 'active',
  proxy_enabled BOOLEAN NOT NULL DEFAULT true,
  widget_fallback_enabled BOOLEAN NOT NULL DEFAULT true,
  commenting_enabled BOOLEAN NOT NULL DEFAULT true,
  feedback_deadline TIMESTAMPTZ,
  require_guest_name BOOLEAN NOT NULL DEFAULT true,
  require_guest_email BOOLEAN NOT NULL DEFAULT false,
  allow_guest_replies BOOLEAN NOT NULL DEFAULT true,
  allow_public_comment_view BOOLEAN NOT NULL DEFAULT true,
  allow_approval BOOLEAN NOT NULL DEFAULT true,
  capture_screenshot BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.canvases ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER canvases_updated_at BEFORE UPDATE ON public.canvases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_canvases_share_token ON public.canvases(share_token);
CREATE INDEX idx_canvases_project ON public.canvases(project_id);

-- =========================================================
-- FEEDBACK ITEMS
-- =========================================================
CREATE TABLE public.feedback_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  canvas_id UUID NOT NULL REFERENCES public.canvases(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id),
  canvas_type public.canvas_type NOT NULL DEFAULT 'website',
  original_page_url TEXT,
  proxied_page_url TEXT,
  page_title TEXT,
  pdf_page_number INTEGER,
  comment TEXT NOT NULL,
  original_text TEXT,
  suggested_text TEXT,
  guest_name TEXT,
  guest_email TEXT,
  status public.feedback_status NOT NULL DEFAULT 'new',
  priority public.feedback_priority NOT NULL DEFAULT 'normal',
  category public.feedback_category NOT NULL DEFAULT 'general',
  x_position NUMERIC,
  y_position NUMERIC,
  x_percent NUMERIC,
  y_percent NUMERIC,
  viewport_width INTEGER,
  viewport_height INTEGER,
  scroll_x INTEGER,
  scroll_y INTEGER,
  element_selector TEXT,
  element_tag TEXT,
  element_id TEXT,
  element_classes TEXT,
  element_text TEXT,
  element_href TEXT,
  element_src TEXT,
  browser TEXT,
  browser_version TEXT,
  operating_system TEXT,
  device_type TEXT,
  user_agent TEXT,
  screen_width INTEGER,
  screen_height INTEGER,
  device_pixel_ratio NUMERIC,
  screenshot_url TEXT,
  assigned_to UUID REFERENCES auth.users(id),
  created_by_type TEXT NOT NULL DEFAULT 'guest' CHECK (created_by_type IN ('guest','team')),
  created_by_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);
ALTER TABLE public.feedback_items ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER feedback_items_updated_at BEFORE UPDATE ON public.feedback_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_feedback_canvas ON public.feedback_items(canvas_id);
CREATE INDEX idx_feedback_project ON public.feedback_items(project_id);
CREATE INDEX idx_feedback_status ON public.feedback_items(status);

-- =========================================================
-- FEEDBACK COMMENTS (replies + internal notes)
-- =========================================================
CREATE TABLE public.feedback_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_item_id UUID NOT NULL REFERENCES public.feedback_items(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  guest_name TEXT,
  guest_email TEXT,
  body TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.feedback_comments ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER feedback_comments_updated_at BEFORE UPDATE ON public.feedback_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_feedback_comments_item ON public.feedback_comments(feedback_item_id);

-- =========================================================
-- REVIEW DECISIONS
-- =========================================================
CREATE TABLE public.review_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  canvas_id UUID NOT NULL REFERENCES public.canvases(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id),
  share_token TEXT,
  reviewer_name TEXT,
  reviewer_email TEXT,
  decision public.review_decision_type NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.review_decisions ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- ACTIVITY LOGS
-- =========================================================
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  canvas_id UUID REFERENCES public.canvases(id) ON DELETE CASCADE,
  feedback_item_id UUID REFERENCES public.feedback_items(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  guest_name TEXT,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_activity_project ON public.activity_logs(project_id);
CREATE INDEX idx_activity_canvas ON public.activity_logs(canvas_id);

-- =========================================================
-- RLS POLICIES (single-workspace MVP)
-- Team members (any user_role row) can read everything.
-- Owner/admin/consultant can manage. All guest interaction is via edge functions.
-- =========================================================

-- profiles
CREATE POLICY "team can read profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- user_roles
CREATE POLICY "team can read roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "owners manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

-- clients
CREATE POLICY "team reads clients" ON public.clients
  FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "managers write clients" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (public.can_manage(auth.uid()));
CREATE POLICY "managers update clients" ON public.clients
  FOR UPDATE TO authenticated USING (public.can_manage(auth.uid()));
CREATE POLICY "managers delete clients" ON public.clients
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin'));

-- projects
CREATE POLICY "team reads projects" ON public.projects
  FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "managers write projects" ON public.projects
  FOR INSERT TO authenticated WITH CHECK (public.can_manage(auth.uid()));
CREATE POLICY "managers update projects" ON public.projects
  FOR UPDATE TO authenticated USING (public.can_manage(auth.uid()));
CREATE POLICY "managers delete projects" ON public.projects
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin'));

-- canvases
CREATE POLICY "team reads canvases" ON public.canvases
  FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "managers write canvases" ON public.canvases
  FOR INSERT TO authenticated WITH CHECK (public.can_manage(auth.uid()));
CREATE POLICY "managers update canvases" ON public.canvases
  FOR UPDATE TO authenticated USING (public.can_manage(auth.uid()));
CREATE POLICY "managers delete canvases" ON public.canvases
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin'));

-- feedback_items
CREATE POLICY "team reads feedback" ON public.feedback_items
  FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "team writes feedback" ON public.feedback_items
  FOR INSERT TO authenticated WITH CHECK (public.is_team_member(auth.uid()));
CREATE POLICY "team updates feedback" ON public.feedback_items
  FOR UPDATE TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "managers delete feedback" ON public.feedback_items
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin'));

-- feedback_comments
CREATE POLICY "team reads comments" ON public.feedback_comments
  FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "team writes comments" ON public.feedback_comments
  FOR INSERT TO authenticated WITH CHECK (public.is_team_member(auth.uid()));
CREATE POLICY "team updates comments" ON public.feedback_comments
  FOR UPDATE TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "managers delete comments" ON public.feedback_comments
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin'));

-- review_decisions
CREATE POLICY "team reads decisions" ON public.review_decisions
  FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));

-- activity_logs
CREATE POLICY "team reads activity" ON public.activity_logs
  FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "team writes activity" ON public.activity_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_team_member(auth.uid()));

-- =========================================================
-- STORAGE BUCKET for screenshots
-- =========================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('screenshots', 'screenshots', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "screenshots public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'screenshots');
