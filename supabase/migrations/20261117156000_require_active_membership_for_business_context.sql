-- Strict tenant context: global project roles do not imply membership in
-- the legacy business. Business-scoped reads/writes require an active
-- business_members row. Project-wide role helpers intentionally remain
-- global for explicitly global administration functions and pages.

CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $current_business_id$
DECLARE
  v_claimed_business_id uuid;
  v_membership_count integer;
  v_resolved_business_id uuid;
BEGIN
  IF auth.jwt() ->> 'role' = 'service_role' OR auth.uid() IS NULL THEN
    RETURN public.legacy_business_id();
  END IF;

  v_claimed_business_id :=
    nullif(auth.jwt() -> 'app_metadata' ->> 'active_business_id', '')::uuid;

  IF v_claimed_business_id IS NOT NULL THEN
    IF public.is_business_member(v_claimed_business_id) THEN
      RETURN v_claimed_business_id;
    END IF;
    -- An invalid or revoked active-business claim must fail closed. Do not
    -- silently fall back to the legacy workspace.
    RETURN NULL;
  END IF;

  SELECT count(*)::integer, (pg_catalog.array_agg(bm.business_id ORDER BY bm.business_id))[1]
    INTO v_membership_count, v_resolved_business_id
  FROM public.business_members bm
  WHERE bm.user_id = auth.uid()
    AND bm.status = 'active';

  IF v_membership_count = 1 THEN
    RETURN v_resolved_business_id;
  ELSIF v_membership_count > 1 THEN
    -- Multiple memberships require an explicit server-signed active claim.
    RETURN NULL;
  END IF;

  -- Business data access always requires an active business membership.
  -- Global project roles remain available to global administration helpers,
  -- but they must not silently grant access to the legacy business workspace.
  RETURN NULL;
END;
$current_business_id$;

CREATE OR REPLACE FUNCTION public.can_access_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $can_access_business$
  SELECT CASE
    WHEN p_business_id IS NULL OR coalesce(auth.role(), '') = 'anon' THEN false
    WHEN auth.uid() IS NULL THEN
      p_business_id = public.legacy_business_id()
    WHEN p_business_id IS DISTINCT FROM public.current_business_id() THEN false
    WHEN public.is_business_member(p_business_id) THEN true
    ELSE false
  END;
$can_access_business$;

COMMENT ON FUNCTION public.current_business_id() IS
  'Resolves only an explicitly claimed active membership or a sole active business membership. Global user_roles never grant business context.';

COMMENT ON FUNCTION public.can_access_business(uuid) IS
  'Allows business access only to the active member business, with the legacy service/maintenance context retained when auth.uid() is null.';
