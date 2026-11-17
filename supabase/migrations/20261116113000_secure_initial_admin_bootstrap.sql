-- Restrict and serialize the one-time initial administrator bootstrap.
-- The table lock prevents two first users from both observing an empty role table.
-- This is only used during initial setup; normal role management is unaffected.

CREATE OR REPLACE FUNCTION public.is_first_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $is_first_user$
  SELECT auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.user_roles);
$is_first_user$;

CREATE OR REPLACE FUNCTION public.claim_initial_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $claim_initial_admin$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to claim the initial administrator role'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize the empty-table check with every concurrent role-table writer.
  LOCK TABLE public.user_roles IN EXCLUSIVE MODE;

  IF EXISTS (SELECT 1 FROM public.user_roles) THEN
    RETURN false;
  END IF;

  INSERT INTO public.user_roles (user_id, role, granted_by)
  VALUES (current_user_id, 'admin'::public.app_role, current_user_id);

  RETURN true;
END;
$claim_initial_admin$;

REVOKE EXECUTE ON FUNCTION public.is_first_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_initial_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_first_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_initial_admin() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
