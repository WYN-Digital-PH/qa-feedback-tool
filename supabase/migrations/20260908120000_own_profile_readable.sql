-- A user can always read their own profile.
--
-- `team can read profiles` gated SELECT entirely on `is_team_member()`, which
-- is true only once somebody has been granted a role. The UPDATE policy is
-- `auth.uid() = id`, so an account still waiting for a role could change its
-- own display name but never read it back: the Settings field loaded blank and
-- could not confirm what had been saved.
--
-- The app explicitly supports that waiting state -- the dashboard shows a
-- "waiting for a role" banner -- and setting your own name is one of the few
-- useful things to do in it.
--
-- Additive: SELECT is only widened, and only to the caller's own row. Nobody
-- gains sight of anyone else's profile.
DROP POLICY IF EXISTS "team can read profiles" ON public.profiles;
CREATE POLICY "team can read profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_team_member(auth.uid()) OR auth.uid() = id);
