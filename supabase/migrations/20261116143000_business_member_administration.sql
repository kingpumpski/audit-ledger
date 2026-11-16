-- Audited business membership administration for existing registered users.
-- Invitation delivery/acceptance for users who do not yet have accounts is a
-- separate Auth/Edge Function workflow and is deliberately not simulated here.

CREATE OR REPLACE FUNCTION public.set_business_member_access(
  p_business_id uuid,
  p_user_id uuid,
  p_role text,
  p_status text DEFAULT 'active'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $set_business_member_access$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_business_status text;
  v_existing public.business_members%ROWTYPE;
  v_member_id uuid;
  v_old_data jsonb;
  v_new_data jsonb;
  v_action public.audit_action;
  v_target_email text;
  v_active_owner_count integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_business_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Business and user are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('owner', 'admin', 'accountant', 'cashier', 'auditor') THEN
    RAISE EXCEPTION 'Unsupported business role'
      USING ERRCODE = '22023';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Membership status must be active or suspended'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_id::text, 0)
  );

  SELECT b.status INTO v_business_status
  FROM public.businesses b
  WHERE b.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND OR v_business_status <> 'active' THEN
    RAISE EXCEPTION 'Business is unavailable for membership changes'
      USING ERRCODE = '42501';
  END IF;

  SELECT bm.role INTO v_actor_role
  FROM public.business_members bm
  WHERE bm.business_id = p_business_id
    AND bm.user_id = v_actor_id
    AND bm.status = 'active'
  FOR UPDATE;

  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an active business owner or administrator may manage members'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'admin'
     AND (p_role IN ('owner', 'admin') OR p_user_id = v_actor_id) THEN
    RAISE EXCEPTION 'Administrators cannot grant owner/admin access or change their own membership'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'The selected user does not have an account'
      USING ERRCODE = '22023';
  END IF;

  SELECT u.email INTO v_target_email
  FROM auth.users u
  WHERE u.id = p_user_id;

  SELECT bm.* INTO v_existing
  FROM public.business_members bm
  WHERE bm.business_id = p_business_id
    AND bm.user_id = p_user_id
  FOR UPDATE;

  IF FOUND THEN
    v_member_id := v_existing.id;
    v_old_data := pg_catalog.jsonb_build_object('role', v_existing.role, 'status', v_existing.status);
  ELSE
    v_old_data := NULL;
  END IF;

  IF v_actor_role = 'admin'
     AND v_existing.id IS NOT NULL
     AND v_existing.role IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Administrators cannot modify owner/admin memberships'
      USING ERRCODE = '42501';
  END IF;

  IF v_existing.id IS NOT NULL
     AND v_existing.role = 'owner'
     AND (p_role <> 'owner' OR p_status <> 'active') THEN
    SELECT count(*) INTO v_active_owner_count
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.role = 'owner'
      AND bm.status = 'active';

    IF v_active_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove or suspend the final active owner'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.business_members (
      business_id, user_id, role, status, invited_by, joined_at
    )
    VALUES (
      p_business_id, p_user_id, p_role, p_status, v_actor_id,
      CASE WHEN p_status = 'active' THEN pg_catalog.now() ELSE NULL END
    )
    RETURNING id INTO v_member_id;
    v_action := 'create';
  ELSE
    UPDATE public.business_members
    SET role = p_role,
        status = p_status,
        invited_by = CASE
          WHEN p_status = 'active' AND v_existing.status <> 'active' THEN v_actor_id
          ELSE invited_by
        END,
        joined_at = CASE
          WHEN p_status = 'active' AND joined_at IS NULL THEN pg_catalog.now()
          ELSE joined_at
        END
    WHERE id = v_existing.id
    RETURNING id INTO v_member_id;
    v_action := 'update';
  END IF;

  v_new_data := pg_catalog.jsonb_build_object(
    'role', p_role, 'status', p_status,
    'target_user_id', p_user_id, 'target_email', v_target_email
  );

  INSERT INTO public.audit_logs (
    user_id, user_email, action, entity_type, entity_id, old_data, new_data, metadata
  )
  SELECT
    v_actor_id, u.email, v_action, 'business_member', v_member_id,
    v_old_data, v_new_data, pg_catalog.jsonb_build_object('business_id', p_business_id)
  FROM auth.users u
  WHERE u.id = v_actor_id;

  RETURN v_member_id;
END;
$set_business_member_access$;

REVOKE ALL ON FUNCTION public.set_business_member_access(uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_business_member_access(uuid, uuid, text, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

-- CI refresh: rerun the clean migration replay and membership pgTAP checks after base retargeting.
