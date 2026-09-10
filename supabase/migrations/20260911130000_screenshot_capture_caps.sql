-- =========================================================================
-- Screenshot capture caps
-- =========================================================================
--
-- Every capture is a paid browserless render. Rate limiting (20260911120000)
-- bounds how fast they can be requested; it does nothing about the total. A
-- busy canvas, or a loop that retries for a week, can still run up a bill.
--
-- Two ceilings, both checked before browserless is called:
--
--   canvas   how many captures one canvas may ever produce
--   month    how many the whole workspace may produce in a calendar month
--
-- Both are consumed in one call so a capture cannot pass the canvas check,
-- fail the monthly one, and still have burnt a canvas slot.

CREATE TABLE IF NOT EXISTS public.screenshot_usage (
  scope       TEXT NOT NULL CHECK (scope IN ('canvas', 'month')),
  -- canvas id for 'canvas', 'YYYY-MM' (UTC) for 'month'
  key         TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  -- Set when the 80% notice has gone out, so it goes out once per counter
  -- rather than on every capture past the threshold.
  warned_at   TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

ALTER TABLE public.screenshot_usage ENABLE ROW LEVEL SECURITY;

-- Read-only to the team, so usage can be shown in the app later. Only the
-- SECURITY DEFINER function below ever writes it.
DROP POLICY IF EXISTS "team reads screenshot usage" ON public.screenshot_usage;
CREATE POLICY "team reads screenshot usage" ON public.screenshot_usage
  FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));

REVOKE ALL ON public.screenshot_usage FROM anon, authenticated;
GRANT SELECT ON public.screenshot_usage TO authenticated;
GRANT ALL ON public.screenshot_usage TO service_role;

-- -------------------------------------------------------------------------
-- Consume one capture against both ceilings
-- -------------------------------------------------------------------------
--
-- Refuses without consuming: a blocked attempt must not inflate the counter,
-- or a caller that keeps retrying would push the number ever further past the
-- cap and the 80% notice would fire on traffic that never rendered anything.
--
-- Both counter rows are locked, always canvas-then-month, so two captures
-- arriving together cannot both read "99 of 100" and both proceed. The fixed
-- order is what stops two callers deadlocking against each other.

CREATE OR REPLACE FUNCTION public.screenshot_quota_consume(
  _canvas_id      UUID,
  _canvas_limit   INTEGER,
  _monthly_limit  INTEGER
)
RETURNS TABLE (
  allowed        BOOLEAN,
  reason         TEXT,
  canvas_used    INTEGER,
  canvas_limit   INTEGER,
  month_used     INTEGER,
  month_limit    INTEGER,
  warned         BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  month_key    TEXT := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM');
  c_used       INTEGER;
  m_used       INTEGER;
  c_warned     TIMESTAMPTZ;
  m_warned     TIMESTAMPTZ;
  did_warn     BOOLEAN := false;
  block_reason TEXT := NULL;
  project      UUID;
BEGIN
  IF _canvas_id IS NULL OR _canvas_limit IS NULL OR _monthly_limit IS NULL
     OR _canvas_limit < 0 OR _monthly_limit < 0 THEN
    RAISE EXCEPTION 'screenshot_quota_consume: canvas id and non-negative limits are required';
  END IF;

  -- Make sure both rows exist before locking them.
  INSERT INTO public.screenshot_usage (scope, key) VALUES ('canvas', _canvas_id::text)
    ON CONFLICT (scope, key) DO NOTHING;
  INSERT INTO public.screenshot_usage (scope, key) VALUES ('month', month_key)
    ON CONFLICT (scope, key) DO NOTHING;

  SELECT used, warned_at INTO c_used, c_warned
  FROM public.screenshot_usage
  WHERE scope = 'canvas' AND key = _canvas_id::text
  FOR UPDATE;

  SELECT used, warned_at INTO m_used, m_warned
  FROM public.screenshot_usage
  WHERE scope = 'month' AND key = month_key
  FOR UPDATE;

  IF c_used >= _canvas_limit THEN
    block_reason := 'canvas_cap';
  ELSIF m_used >= _monthly_limit THEN
    block_reason := 'monthly_cap';
  END IF;

  IF block_reason IS NOT NULL THEN
    RETURN QUERY SELECT false, block_reason, c_used, _canvas_limit, m_used, _monthly_limit, false;
    RETURN;
  END IF;

  UPDATE public.screenshot_usage
    SET used = used + 1, updated_at = now()
    WHERE scope = 'canvas' AND key = _canvas_id::text;
  UPDATE public.screenshot_usage
    SET used = used + 1, updated_at = now()
    WHERE scope = 'month' AND key = month_key;

  c_used := c_used + 1;
  m_used := m_used + 1;

  SELECT c.project_id INTO project FROM public.canvases c WHERE c.id = _canvas_id;

  -- 80% notices. `warned_at` makes each one fire once per counter, on the
  -- capture that crosses the line, rather than on every capture after it.
  IF c_warned IS NULL AND _canvas_limit > 0
     AND c_used >= CEIL(_canvas_limit * 0.8) THEN
    UPDATE public.screenshot_usage SET warned_at = now()
      WHERE scope = 'canvas' AND key = _canvas_id::text;
    PERFORM public.notify_screenshot_quota(
      'This canvas has used ' || c_used || ' of its ' || _canvas_limit || ' screenshot captures',
      project, _canvas_id
    );
    did_warn := true;
  END IF;

  IF m_warned IS NULL AND _monthly_limit > 0
     AND m_used >= CEIL(_monthly_limit * 0.8) THEN
    UPDATE public.screenshot_usage SET warned_at = now()
      WHERE scope = 'month' AND key = month_key;
    PERFORM public.notify_screenshot_quota(
      'The workspace has used ' || m_used || ' of its ' || _monthly_limit
        || ' screenshot captures for ' || month_key,
      project, NULL
    );
    did_warn := true;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT, c_used, _canvas_limit, m_used, _monthly_limit, did_warn;
END;
$$;

-- -------------------------------------------------------------------------
-- Who hears about it
-- -------------------------------------------------------------------------
-- Owners and admins: they are the ones who can raise a cap or investigate the
-- traffic. Uses the same notifications table as assignments and mentions, so
-- it lands in the bell people already watch.

CREATE OR REPLACE FUNCTION public.notify_screenshot_quota(
  _body       TEXT,
  _project_id UUID DEFAULT NULL,
  _canvas_id  UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sent INTEGER := 0;
BEGIN
  INSERT INTO public.notifications (user_id, kind, title, body, project_id)
  SELECT DISTINCT ur.user_id,
         'screenshot_quota',
         'Screenshot capture nearing its limit',
         left(_body, 200),
         _project_id
  FROM public.user_roles ur
  WHERE ur.role IN ('owner', 'admin');

  GET DIAGNOSTICS sent = ROW_COUNT;
  RETURN sent;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_screenshot_quota(TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.screenshot_quota_consume(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.screenshot_quota_consume(UUID, INTEGER, INTEGER) TO service_role;

-- -------------------------------------------------------------------------
-- Reading usage back
-- -------------------------------------------------------------------------
-- For the tests, and for anything that later wants to show remaining budget
-- without consuming any of it.

CREATE OR REPLACE FUNCTION public.screenshot_quota_status(_canvas_id UUID)
RETURNS TABLE (canvas_used INTEGER, month_used INTEGER, month_key TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((SELECT used FROM public.screenshot_usage
              WHERE scope = 'canvas' AND key = _canvas_id::text), 0),
    COALESCE((SELECT used FROM public.screenshot_usage
              WHERE scope = 'month' AND key = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM')), 0),
    to_char(now() AT TIME ZONE 'utc', 'YYYY-MM');
$$;

REVOKE ALL ON FUNCTION public.screenshot_quota_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.screenshot_quota_status(UUID) TO authenticated, service_role;
