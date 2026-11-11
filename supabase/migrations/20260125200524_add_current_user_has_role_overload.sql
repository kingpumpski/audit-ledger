-- Preserve the original two-argument role check while supporting policies
-- that check the currently authenticated user's role.
--
-- The original schema defines has_role(user_id, role), but the company settings
-- migration calls has_role('admin'). This overload resolves that call safely
-- against auth.uid(); unauthenticated requests return false.
CREATE OR REPLACE FUNCTION public.has_role(_role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), _role);
$$;

REVOKE ALL ON FUNCTION public.has_role(public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(public.app_role) TO authenticated, service_role;
