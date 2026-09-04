GRANT EXECUTE ON FUNCTION public.is_team_member(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_manage(uuid) TO authenticated, anon;