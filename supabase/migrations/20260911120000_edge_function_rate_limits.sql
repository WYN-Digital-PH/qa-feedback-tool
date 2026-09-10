-- =========================================================================
-- Rate limiting for the public edge functions
-- =========================================================================
--
-- The nine functions with `verify_jwt = false` are reachable by anyone who
-- knows the URL. Several are expensive: `proxy-website` fetches a whole
-- external site per call and `capture-screenshot` spends money at browserless.
-- Nothing bounded how often any of them could be called.
--
-- The counter lives in Postgres rather than in the function. Edge isolates are
-- ephemeral and there are many of them at once, so an in-process Map would
-- reset on every cold start and count only its own share of the traffic --
-- which is no limit at all.
--
-- Fixed windows, not a sliding log: one row per bucket per window, so the
-- table stays small and the check is a single upsert.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  -- "<scope>:<identifier>:<function>", e.g. "ip:203.0.113.7:proxy-website"
  bucket        TEXT PRIMARY KEY,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
  hits          INTEGER     NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sweeping expired rows needs to find them without a full scan.
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start
  ON public.rate_limits (window_start);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- No policies at all: the table is written only by the SECURITY DEFINER
-- function below, and read by nobody. A client that could read it would learn
-- which share tokens are in use; one that could write it could clear its own
-- counter. Supabase grants new public tables to anon and authenticated by
-- default, so take that back rather than relying on RLS alone.
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
GRANT ALL ON public.rate_limits TO service_role;

-- -------------------------------------------------------------------------
-- The check itself
-- -------------------------------------------------------------------------
--
-- One statement, so two requests arriving together cannot both read "9 hits"
-- and both write "10". `INSERT ... ON CONFLICT DO UPDATE` takes a row lock,
-- and the CASE inside decides in the same breath whether this hit starts a new
-- window or joins the current one.
--
-- Returns the state *after* counting this request, so `allowed` is false on
-- the request that goes over rather than the one after it.

CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  _bucket          TEXT,
  _limit           INTEGER,
  _window_seconds  INTEGER
)
RETURNS TABLE (allowed BOOLEAN, hits INTEGER, limit_value INTEGER, retry_after INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_window TIMESTAMPTZ;
  row_hits   INTEGER;
BEGIN
  IF _bucket IS NULL OR _limit IS NULL OR _limit < 1 OR _window_seconds IS NULL OR _window_seconds < 1 THEN
    RAISE EXCEPTION 'rate_limit_hit: bucket, limit and window are required';
  END IF;

  INSERT INTO public.rate_limits AS rl (bucket, window_start, hits, updated_at)
  VALUES (_bucket, now(), 1, now())
  ON CONFLICT (bucket) DO UPDATE
    SET
      -- Past the end of its window, this row starts a fresh one.
      window_start = CASE
        WHEN rl.window_start < now() - make_interval(secs => _window_seconds)
          THEN now()
        ELSE rl.window_start
      END,
      hits = CASE
        WHEN rl.window_start < now() - make_interval(secs => _window_seconds)
          THEN 1
        ELSE rl.hits + 1
      END,
      updated_at = now()
  RETURNING rl.window_start, rl.hits INTO row_window, row_hits;

  RETURN QUERY SELECT
    row_hits <= _limit,
    row_hits,
    _limit,
    GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (row_window + make_interval(secs => _window_seconds) - now())))::INTEGER
    );
END;
$$;

-- Callable only by the service role the edge functions run as. A client that
-- could call it directly could burn through someone else's allowance.
REVOKE ALL ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) TO service_role;

-- -------------------------------------------------------------------------
-- Housekeeping
-- -------------------------------------------------------------------------
-- Rows are only ever useful for the length of their window. Without a sweep
-- the table grows by one row per distinct IP for ever.

CREATE OR REPLACE FUNCTION public.prune_rate_limits(_older_than_seconds INTEGER DEFAULT 3600)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM public.rate_limits
  WHERE window_start < now() - make_interval(secs => _older_than_seconds);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_rate_limits(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_rate_limits(INTEGER) TO service_role;
