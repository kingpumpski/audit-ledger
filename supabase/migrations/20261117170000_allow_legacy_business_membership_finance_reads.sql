-- Keep finance RLS compatible with membership-only users in the legacy workspace.
-- Do not grant membership-derived roles for non-legacy businesses until the
-- tenant-isolating RLS cutover is deployed and verified. Existing global role
-- assignments remain supported during the transition.
CREATE OR REPLACE FUNCTION public.has_any_role(_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $has_any_role$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = (SELECT auth.uid())
          AND ur.role::text = ANY(COALESCE(_roles, ARRAY[]::text[]))
      )
      OR EXISTS (
        SELECT 1
        FROM public.business_members bm
        JOIN public.businesses b ON b.id = bm.business_id
        WHERE bm.user_id = (SELECT auth.uid())
          AND bm.status = 'active'
          AND bm.role = ANY(COALESCE(_roles, ARRAY[]::text[]))
          AND b.business_type = 'legacy_workspace'
          AND bm.business_id = (SELECT public.current_business_id())
      )
    );
$has_any_role$;

REVOKE ALL ON FUNCTION public.has_any_role(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_any_role(text[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
