-- Add the current-user role-array overload used by the company settings
-- policies. The original has_any_role(uuid) remains available for existing callers.
CREATE OR REPLACE FUNCTION public.has_any_role(_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role::text = ANY(COALESCE(_roles, ARRAY[]::text[]))
    );
$$;

REVOKE ALL ON FUNCTION public.has_any_role(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_any_role(text[]) TO authenticated, service_role;
