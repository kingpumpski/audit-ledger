-- Prevent authenticated callers from enumerating another user's role assignments.
-- Existing RLS policies pass auth.uid(), so self-check behavior remains unchanged.
-- Administrators and trusted service-role callers retain legitimate cross-user lookup.
-- Use auth.jwt()->>'role' for service-role detection; auth.role() is deprecated.

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $get_user_role$
  SELECT CASE
    WHEN _user_id IS NULL THEN NULL::public.app_role
    WHEN COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
      OR _user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.user_roles actor_role
        WHERE actor_role.user_id = auth.uid()
          AND actor_role.role = 'admin'::public.app_role
      )
    THEN (
      SELECT ur.role
      FROM public.user_roles ur
      WHERE ur.user_id = _user_id
      ORDER BY CASE ur.role
        WHEN 'admin'::public.app_role THEN 1
        WHEN 'accountant'::public.app_role THEN 2
        WHEN 'auditor'::public.app_role THEN 3
        WHEN 'cashier'::public.app_role THEN 4
      END
      LIMIT 1
    )
    ELSE NULL::public.app_role
  END;
$get_user_role$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $has_any_role_user$
  SELECT CASE
    WHEN _user_id IS NULL THEN false
    WHEN COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
      OR _user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.user_roles actor_role
        WHERE actor_role.user_id = auth.uid()
          AND actor_role.role = 'admin'::public.app_role
      )
    THEN EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = _user_id
    )
    ELSE false
  END;
$has_any_role_user$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $has_role_user$
  SELECT CASE
    WHEN _user_id IS NULL OR _role IS NULL THEN false
    WHEN COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
      OR _user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.user_roles actor_role
        WHERE actor_role.user_id = auth.uid()
          AND actor_role.role = 'admin'::public.app_role
      )
    THEN EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.role = _role
    )
    ELSE false
  END;
$has_role_user$;

REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
