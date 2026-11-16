-- Keep the existing RPC signature for frontend compatibility, but enforce
-- authorization inside the SECURITY DEFINER boundary and derive the actor
-- exclusively from the verified JWT identity.
CREATE OR REPLACE FUNCTION public.assign_user_role(
  target_user uuid,
  role_name public.app_role,
  granted_by_user uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.has_any_role(ARRAY['admin']::text[]) THEN
    RAISE EXCEPTION 'Only an authenticated administrator can assign user roles'
      USING ERRCODE = '42501';
  END IF;

  IF target_user IS NULL OR role_name IS NULL THEN
    RAISE EXCEPTION 'A target user and role are required'
      USING ERRCODE = '22023';
  END IF;

  -- The legacy caller-supplied actor is never trusted. Reject mismatches to
  -- surface stale or malicious clients rather than silently accepting them.
  IF granted_by_user IS NOT NULL AND granted_by_user IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'The granting user must match the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = target_user AND role = role_name
  ) THEN
    INSERT INTO public.user_roles (id, user_id, role, granted_by, granted_at)
    VALUES (gen_random_uuid(), target_user, role_name, v_actor, now());

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, new_data)
    VALUES (
      v_actor,
      'create',
      'user_roles',
      target_user,
      jsonb_build_object('role', role_name)
    );
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_user_role(uuid, public.app_role, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_user_role(uuid, public.app_role, uuid)
  TO authenticated, service_role;
