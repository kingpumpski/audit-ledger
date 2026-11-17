-- Secure invitation lifecycle for new business members. Invitation delivery
-- uses the Auth Admin API in trusted Edge Functions; this table never exposes
-- raw invitation tokens or allows clients to write membership state directly.

CREATE TABLE public.business_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND position('@' in email) > 1),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'accountant', 'cashier', 'auditor')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired', 'failed')),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_business_invitations_pending_email
  ON public.business_invitations (business_id, email)
  WHERE status = 'pending';
CREATE INDEX idx_business_invitations_business_status
  ON public.business_invitations (business_id, status, created_at DESC);
CREATE INDEX idx_business_invitations_expiry
  ON public.business_invitations (expires_at)
  WHERE status = 'pending';

ALTER TABLE public.business_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.business_invitations TO authenticated;
GRANT ALL ON TABLE public.business_invitations TO service_role;

CREATE POLICY business_invitations_select_managers
  ON public.business_invitations
  FOR SELECT
  TO authenticated
  USING (public.has_business_role(business_id, ARRAY['owner', 'admin']::text[]));

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

  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'This invitation is no longer pending'
      USING ERRCODE = '55000';
  END IF;

  IF v_invitation.expires_at <= pg_catalog.now() THEN
    UPDATE public.business_invitations
    SET status = 'expired', updated_at = pg_catalog.now()
    WHERE id = v_invitation.id;
    RAISE EXCEPTION 'This invitation has expired'
      USING ERRCODE = '55000';
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

  IF NOT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = v_invitation.business_id
      AND bm.user_id = v_invitation.invited_by
      AND bm.status = 'active'
      AND bm.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'The person who issued this invitation is no longer authorized'
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
  SELECT
    v_user_id, u.email, 'update'::public.audit_action, 'business_invitation',
    v_invitation.id,
    pg_catalog.jsonb_build_object('status', 'pending', 'email', v_invitation.email, 'role', v_invitation.role),
    pg_catalog.jsonb_build_object('status', 'revoked'),
    pg_catalog.jsonb_build_object('business_id', v_invitation.business_id),
    v_invitation.business_id
  FROM auth.users u
  WHERE u.id = v_user_id;

  RETURN true;
END;
$revoke_business_invitation$;

REVOKE ALL ON FUNCTION public.accept_business_invitation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_business_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_business_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_business_invitation(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
