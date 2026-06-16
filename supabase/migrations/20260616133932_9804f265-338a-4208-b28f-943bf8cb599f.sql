
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_any_role(text[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_next_sequence(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_first_user() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.claim_initial_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_permission(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_users_with_roles() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.assign_user_role(uuid, app_role, uuid) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_sequence(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_first_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_initial_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_users_with_roles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_user_role(uuid, app_role, uuid) TO authenticated;
