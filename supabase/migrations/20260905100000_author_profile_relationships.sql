-- =========================================================================
-- Let an author's name be read alongside what they wrote
-- =========================================================================
--
-- The activity timeline and the thread on a feedback preview have always been
-- empty. Not slow, not partial — empty, every time, for everyone.
--
-- Both read their rows with an embedded author:
--
--     .select("*, profiles(full_name, email)")
--
-- PostgREST resolves an embed like that through a foreign key between the two
-- tables. There isn't one. `activity_logs.user_id` and
-- `feedback_comments.user_id` both point at `auth.users`, while `profiles` is a
-- separate table that also points at `auth.users`. Two arrows into the same
-- target is not a relationship PostgREST can follow, so the request fails with
-- PGRST200 and returns no rows.
--
-- The reason it looked like "no activity yet" rather than an error is that
-- every call site reads `const { data } = await q` and drops the error on the
-- floor, so an empty list and a failed query are indistinguishable. The client
-- side of that is fixed alongside this; the schema is the actual defect.
--
-- Pointing the columns at `profiles` instead of `auth.users` is the standard
-- shape for this. Integrity to the auth table is not lost: `profiles.id` is
-- itself a foreign key onto `auth.users(id)` with ON DELETE CASCADE, so a user
-- row still cannot exist here without existing there.

-- -------------------------------------------------------------------------
-- 1. Make sure every author actually has a profile row
-- -------------------------------------------------------------------------
--
-- `handle_new_user` has created one on signup since the first migration, so
-- this should find nothing. It runs anyway because the alternative is the
-- foreign key below failing halfway through a deploy on a single row written
-- before that trigger existed.

INSERT INTO public.profiles (id, email, full_name)
SELECT u.id,
       u.email,
       COALESCE(u.raw_user_meta_data ->> 'full_name', u.email)
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- -------------------------------------------------------------------------
-- 2. Re-point the author columns at profiles
-- -------------------------------------------------------------------------
--
-- ON DELETE SET NULL, because the record of what happened outlives the account
-- that did it. A deleted teammate leaves their activity and their replies in
-- place, attributed to nobody, rather than taking the history with them — the
-- UI already renders a null author as "System".

ALTER TABLE public.activity_logs
  DROP CONSTRAINT IF EXISTS activity_logs_user_id_fkey;
ALTER TABLE public.activity_logs
  ADD CONSTRAINT activity_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.feedback_comments
  DROP CONSTRAINT IF EXISTS feedback_comments_user_id_fkey;
ALTER TABLE public.feedback_comments
  ADD CONSTRAINT feedback_comments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- The embed joins on these on every timeline and every thread open.
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_comments_user ON public.feedback_comments(user_id);

COMMENT ON CONSTRAINT activity_logs_user_id_fkey ON public.activity_logs IS
  'Points at profiles, not auth.users, so PostgREST can embed the author. Integrity to auth is kept by profiles.id.';
COMMENT ON CONSTRAINT feedback_comments_user_id_fkey ON public.feedback_comments IS
  'Points at profiles, not auth.users, so PostgREST can embed the author. Integrity to auth is kept by profiles.id.';
