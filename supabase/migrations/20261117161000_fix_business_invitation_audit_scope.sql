-- Invitation lifecycle audit records are business-scoped. Keeping the
-- business_id in metadata alone is insufficient: RLS and the activity
-- notification fan-out use audit_logs.business_id to enforce/route the event.
-- The previous definitions wrote NULL, causing invitation events to be
-- treated as project-wide activity and potentially visible outside the
-- affected workspace. These replacements preserve the original authorization
-- and lifecycle logic while setting the owning business column.

CREATE OR REPLACE FUNCTION public.accept_business_invitation(p_invitation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $accept_business_invitation$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_invitation public.business_invitations%ROWTYPE;
  v_existing public.business_members%ROWTYPE;
  v_member_id uuid;
  v_inviter_role text;
BEGIN
  IF v_user_id IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'A verified authenticated email is required to accept an invitation'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invitation
  FROM public.business_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_invitation.status = 'accepted' THEN
    IF v_invitation.accepted_user_id = v_user_id THEN
      RETURN v_invitation.business_id;
    END IF;
    RAISE EXCEPTION 'This invitation has already been accepted by another account'
      USING ERRCODE = '55000';
  END IF;

  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'This invitation is no longer pending'
      USING ERRCODE = '55000';
  END IF;

  IF v_invitation.expires_at <= pg_catalog.now() THEN
    UPDATE public.business_invitations
    SET status = 'expired', updated_at = pg_catalog.now()
    WHERE id = v_invitation.id;
    -- Return NULL so the expiry state commits. Raising an exception here
    -- would roll back the status update with the surrounding transaction.
    RETURN NULL;
  END IF;

  IF v_email <> v_invitation.email THEN
    RAISE EXCEPTION 'Sign in with the email address that received this invitation'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = v_invitation.business_id AND b.status = 'active'
  ) THEN
    RAISE EXCEPTION 'The invited business is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT bm.role INTO v_inviter_role
  FROM public.business_members bm
  WHERE bm.business_id = v_invitation.business_id
    AND bm.user_id = v_invitation.invited_by
    AND bm.status = 'active'
  FOR UPDATE;

  IF v_inviter_role IS NULL OR v_inviter_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'The person who issued this invitation is no longer authorized'
      USING ERRCODE = '42501';
  END IF;

  IF v_inviter_role = 'admin' AND v_invitation.role IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Administrators cannot issue owner or administrator access'
      USING ERRCODE = '42501';
  END IF;

  IF v_invitation.auth_user_id IS NOT NULL
     AND v_invitation.auth_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'This invitation is bound to a different user account'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.rpc_auth_user_email_confirmed(v_user_id, v_email) THEN
    RAISE EXCEPTION 'Confirm the invited email address before accepting this invitation'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.business_members
  WHERE business_id = v_invitation.business_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF FOUND AND v_existing.status = 'active' THEN
    RAISE EXCEPTION 'You are already an active member of this business'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.business_members (
    business_id, user_id, role, status, invited_by, joined_at
  )
  VALUES (
    v_invitation.business_id, v_user_id, v_invitation.role, 'active',
    v_invitation.invited_by, pg_catalog.now()
  )
  ON CONFLICT (business_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        status = 'active',
        invited_by = EXCLUDED.invited_by,
        joined_at = pg_catalog.now()
  RETURNING id INTO v_member_id;

  UPDATE public.business_invitations
  SET status = 'accepted',
      accepted_user_id = v_user_id,
      accepted_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = v_invitation.id;

  INSERT INTO public.audit_logs (
    user_id, user_email, action, entity_type, entity_id,
    old_data, new_data, metadata, business_id
  )
  VALUES (
    v_user_id, v_email, 'create'::public.audit_action,
    'business_member', v_member_id, NULL,
    pg_catalog.jsonb_build_object(
      'role', v_invitation.role, 'status', 'active',
      'target_user_id', v_user_id, 'target_email', v_email
    ),
    pg_catalog.jsonb_build_object('business_id', v_invitation.business_id, 'invitation_id', v_invitation.id),
    v_invitation.business_id
  );

  RETURN v_invitation.business_id;
END;
$accept_business_invitation$;

CREATE OR REPLACE FUNCTION public.revoke_business_invitation(p_invitation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $revoke_business_invitation$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_role text;
  v_invitation public.business_invitations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invitation
  FROM public.business_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND OR v_invitation.status <> 'pending' THEN
    RETURN false;
  END IF;

  SELECT bm.role INTO v_actor_role
  FROM public.business_members bm
  WHERE bm.business_id = v_invitation.business_id
    AND bm.user_id = v_user_id
    AND bm.status = 'active'
  FOR UPDATE;

  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an active business owner or administrator may revoke invitations'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'admin' AND v_invitation.role IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Administrators cannot revoke owner/admin invitations'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.business_invitations
  SET status = 'revoked', revoked_at = pg_catalog.now(), updated_at = pg_catalog.now()
  WHERE id = v_invitation.id;

  INSERT INTO public.audit_logs (
    user_id, user_email, action, entity_type, entity_id, old_data, new_data, metadata, business_id
  )
  VALUES (
    v_user_id, public.rpc_auth_user_email(v_user_id), 'update'::public.audit_action,
    'business_invitation', v_invitation.id,
    pg_catalog.jsonb_build_object('status', 'pending', 'email', v_invitation.email, 'role', v_invitation.role),
    pg_catalog.jsonb_build_object('status', 'revoked'),
    pg_catalog.jsonb_build_object('business_id', v_invitation.business_id),
    v_invitation.business_id
  );

  RETURN true;
END;
$revoke_business_invitation$;
