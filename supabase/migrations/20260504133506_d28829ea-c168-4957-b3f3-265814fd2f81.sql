ALTER TABLE public.feedback_items ADD COLUMN IF NOT EXISTS pin_number integer;

UPDATE public.feedback_items f
SET pin_number = sub.rn
FROM (
  SELECT id, row_number() OVER (PARTITION BY canvas_id ORDER BY created_at, id) AS rn
  FROM public.feedback_items
) sub
WHERE f.id = sub.id AND f.pin_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS feedback_items_canvas_pin_unique
  ON public.feedback_items(canvas_id, pin_number);

CREATE OR REPLACE FUNCTION public.assign_feedback_pin_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_n integer;
BEGIN
  IF NEW.pin_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('feedback_pin:' || NEW.canvas_id::text));
  SELECT COALESCE(MAX(pin_number), 0) + 1 INTO next_n
  FROM public.feedback_items
  WHERE canvas_id = NEW.canvas_id;
  NEW.pin_number := next_n;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_feedback_pin_number ON public.feedback_items;
CREATE TRIGGER trg_assign_feedback_pin_number
BEFORE INSERT ON public.feedback_items
FOR EACH ROW
EXECUTE FUNCTION public.assign_feedback_pin_number();