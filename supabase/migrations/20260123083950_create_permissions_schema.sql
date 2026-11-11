-- The authorization policies reference these tables, but the original schema
-- omitted their creation. Keep this migration immediately before the first RLS
-- migration that expects both relations to exist.
CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role text NOT NULL CHECK (role IN ('admin', 'accountant', 'cashier', 'auditor')),
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role, permission_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.permissions TO service_role;
GRANT ALL ON public.role_permissions TO service_role;

-- The edge authorization function uses a service-role client. Pass the verified
-- user ID explicitly and prevent non-service callers from checking other users.
CREATE OR REPLACE FUNCTION public.has_permission(permission_code text, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN target_user_id IS NULL THEN false
    WHEN coalesce(auth.role(), '') <> 'service_role'
      AND target_user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role = ur.role::text
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = target_user_id
        AND p.code = permission_code
    )
  END;
$$;

-- Preserve the original authenticated-user RPC signature.
CREATE OR REPLACE FUNCTION public.has_permission(permission_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_permission(permission_code, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.has_permission(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated, service_role;
