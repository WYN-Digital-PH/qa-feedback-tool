-- Website review pins are anchored to a DOM element instead of only to
-- document coordinates, so a comment stays on its component when the page
-- reflows at another viewport width (Desktop / Tablet / Mobile) or reloads.
--
--   anchor_selector  CSS selector for the element the pin was placed on
--   anchor_x_percent horizontal offset inside that element's box (0-100)
--   anchor_y_percent vertical offset inside that element's box (0-100)
--
-- x_percent / y_percent are still written and stay the fallback for rows
-- created before anchoring, and for pages where the element can't be found.
ALTER TABLE public.feedback_items
  ADD COLUMN IF NOT EXISTS anchor_selector TEXT,
  ADD COLUMN IF NOT EXISTS anchor_x_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS anchor_y_percent NUMERIC;
