-- =========================================================================
-- A workspace must always have an owner
-- =========================================================================
--
-- `docs/ROLES_AND_PERMISSIONS.md` promises "You cannot lock yourself out —
-- owner permissions are immutable, and the last owner cannot be removed or
-- demoted." The first half was enforced (see `protect_owner_permissions`).
-- The second half was not: the only check was `ownerCount <= 1` in the
-- Settings screen, which
--
--   * reads a count captured when the member list was last loaded, so two
--     people demoting the two remaining owners at once both pass it, and
--   * is absent entirely from a direct PostgREST call, which the
--     "owners manage roles" policy (FOR ALL, USING has_role(uid,'owner'))
--     happily accepts.
--
-- Losing the last owner is unrecoverable from inside the app: only an owner
-- may grant the owner role or edit the permission matrix, so the workspace
-- would need a service-role query against the database to get back.

CREATE OR REPLACE FUNCTION public.protect_last_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining INT;
BEGIN
  -- Only removing or changing an owner row can reduce the owner count.
  IF OLD.role <> 'owner' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- An update that leaves the same person an owner changes nothing.
  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' AND NEW.user_id = OLD.user_id THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO remaining FROM public.user_roles WHERE role = 'owner';

  IF remaining <= 1 THEN
    RAISE EXCEPTION 'A workspace must keep at least one owner. Give someone else the owner role first.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_last_owner() FROM PUBLIC, anon, authenticated;

-- Note: `user_roles.user_id` cascades from `auth.users`, so this also refuses
-- the deletion of the last owner's account until ownership is handed over.
-- That is the intended trade — an orphaned workspace is worse.
DROP TRIGGER IF EXISTS user_roles_protect_last_owner ON public.user_roles;
CREATE TRIGGER user_roles_protect_last_owner
  BEFORE UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_owner();
