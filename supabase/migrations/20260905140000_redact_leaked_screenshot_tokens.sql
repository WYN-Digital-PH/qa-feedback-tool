-- =========================================================================
-- Scrub API tokens out of stored screenshot errors
-- =========================================================================
--
-- `capture-screenshot` wrote the raw exception into
-- `feedback_items.screenshot_error`. Deno puts the full request URL into the
-- message of a network error, and that URL carries the screenshot provider's
-- token as a query parameter — so a failed capture stored a live credential in
-- a text column, where it is shown to every signed-in team member and read back
-- out of the database.
--
-- The function no longer does this. These are the rows written before it
-- stopped.
--
-- Scope of the exposure, for the record: `screenshot_error` is not among the
-- columns `get-public-canvas-comments` returns, so it was never sent to a guest
-- on a public review link. It was readable by the team, stored at rest, and
-- surfaced in whatever anybody pasted out of the UI. The edge function logs
-- hold the same string and cannot be rewritten from here — the token has to be
-- rotated regardless of this migration.

UPDATE public.feedback_items
SET screenshot_error = regexp_replace(
      screenshot_error,
      '([?&]token=)[^&[:space:])"'']+',
      '\1[redacted]',
      'gi'
    )
WHERE screenshot_error ~* '[?&]token=';

-- Anything else that reached the column with a token-shaped query string in it.
UPDATE public.activity_logs
SET details = jsonb_set(
      details,
      '{error}',
      to_jsonb(regexp_replace(details ->> 'error', '([?&]token=)[^&[:space:])"'']+', '\1[redacted]', 'gi'))
    )
WHERE details ? 'error'
  AND details ->> 'error' ~* '[?&]token=';
