-- Tenant isolation cutover:
-- 1) Resolve exactly one active business, or require the signed app_metadata claim.
-- 2) Enforce business scope through restrictive RLS policies.
-- 3) Run public SECURITY DEFINER routines under a non-BYPASSRLS role so RLS
--    applies inside RPCs and triggers, not only direct PostgREST queries.
-- 4) Keep the trusted DDL event-trigger function as postgres because it must
--    enable RLS and create policies on newly-created tables.

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'audit_ledger_rpc_owner') THEN
    CREATE ROLE audit_ledger_rpc_owner NOLOGIN NOBYPASSRLS;
  END IF;
END;
$role$;

ALTER ROLE audit_ledger_rpc_owner NOLOGIN NOBYPASSRLS;
GRANT audit_ledger_rpc_owner TO postgres;
GRANT USAGE, CREATE ON SCHEMA public TO audit_ledger_rpc_owner;
GRANT USAGE ON SCHEMA extensions TO audit_ledger_rpc_owner;
-- Supabase owns the auth schema; postgres cannot grant its ACL directly.
-- Inherit the existing authenticated schema/function grants instead.
GRANT authenticated TO audit_ledger_rpc_owner;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO audit_ledger_rpc_owner;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO audit_ledger_rpc_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO audit_ledger_rpc_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO audit_ledger_rpc_owner;
DO $grant_public_types$
DECLARE
  v_type record;
BEGIN
  FOR v_type IN
    SELECT t.typname
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public'
      AND t.typtype IN ('e','d','r','m')
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT USAGE ON TYPE public.%I TO audit_ledger_rpc_owner',
      v_type.typname
    );
  END LOOP;
END;
$grant_public_types$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO audit_ledger_rpc_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO audit_ledger_rpc_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO audit_ledger_rpc_owner;
-- Narrow access to auth.users through postgres-owned helpers. The Supabase
-- auth schema/table are platform-owned and postgres cannot grant their ACLs.
CREATE OR REPLACE FUNCTION public.rpc_auth_user_exists(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $rpc_auth_user_exists$
  SELECT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id);
$rpc_auth_user_exists$;

CREATE OR REPLACE FUNCTION public.rpc_auth_user_email(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $rpc_auth_user_email$
  SELECT u.email::text FROM auth.users u WHERE u.id = p_user_id;
$rpc_auth_user_email$;

GRANT EXECUTE ON FUNCTION public.rpc_auth_user_exists(uuid) TO audit_ledger_rpc_owner;
GRANT EXECUTE ON FUNCTION public.rpc_auth_user_email(uuid) TO audit_ledger_rpc_owner;

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

  IF NOT public.rpc_auth_user_exists(p_user_id) THEN
    RAISE EXCEPTION 'The selected user does not have an account'
      USING ERRCODE = '22023';
  END IF;

  v_target_email := public.rpc_auth_user_email(p_user_id);

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
  VALUES (
    v_actor_id, public.rpc_auth_user_email(v_actor_id), v_action,
    'business_member', v_member_id, v_old_data, v_new_data,
    pg_catalog.jsonb_build_object('business_id', p_business_id)
  );

  RETURN v_member_id;
END;
$set_business_member_access$;



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

  SELECT count(*)::integer, min(bm.business_id)
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

  -- A suspended or otherwise inactive membership must not fall back to a
  -- global role and regain legacy workspace access.
  IF EXISTS (
    SELECT 1 FROM public.business_members bm WHERE bm.user_id = auth.uid()
  ) THEN
    RETURN NULL;
  END IF;

  -- Transitional fallback for pre-tenancy role-managed accounts only.
  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()) THEN
    RETURN public.legacy_business_id();
  END IF;

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
    WHEN p_business_id = public.legacy_business_id()
      AND NOT EXISTS (
        SELECT 1
        FROM public.business_members bm
        WHERE bm.user_id = auth.uid()
          AND bm.status = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
      ) THEN true
    ELSE false
  END;
$can_access_business$;

CREATE OR REPLACE FUNCTION public.has_any_role(_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $has_any_business_role$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN EXISTS (
      SELECT 1
      FROM public.business_members bm
      WHERE bm.user_id = auth.uid()
        AND bm.status = 'active'
    ) THEN EXISTS (
      SELECT 1
      FROM public.business_members bm
      WHERE bm.user_id = auth.uid()
        AND bm.business_id = public.current_business_id()
        AND bm.status = 'active'
        AND (
          bm.role = ANY(COALESCE(_roles, ARRAY[]::text[]))
          OR (
            bm.role = 'owner'
            AND COALESCE(_roles, ARRAY[]::text[])
              && ARRAY['admin','accountant','cashier','auditor']::text[]
          )
        )
    )
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role::text = ANY(COALESCE(_roles, ARRAY[]::text[]))
    )
  END;
$has_any_business_role$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $has_any_user_business_role$
  SELECT CASE
    WHEN _user_id IS NULL THEN false
    WHEN _user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.business_members bm
        WHERE bm.user_id = _user_id AND bm.status = 'active'
      ) THEN EXISTS (
        SELECT 1 FROM public.business_members bm
        WHERE bm.user_id = _user_id
          AND bm.business_id = public.current_business_id()
          AND bm.status = 'active'
      )
    WHEN COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
      OR _user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_roles actor_role
        WHERE actor_role.user_id = auth.uid()
          AND actor_role.role = 'admin'::public.app_role
      ) THEN EXISTS (
        SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id
      )
    ELSE false
  END;
$has_any_user_business_role$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $has_business_role$
  SELECT CASE
    WHEN _user_id IS NULL OR _role IS NULL THEN false
    WHEN _user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.business_members bm
        WHERE bm.user_id = _user_id AND bm.status = 'active'
      ) THEN EXISTS (
        SELECT 1
        FROM public.business_members bm
        WHERE bm.user_id = _user_id
          AND bm.business_id = public.current_business_id()
          AND bm.status = 'active'
          AND (
            bm.role = _role::text
            OR (bm.role = 'owner' AND _role::text = ANY(
              ARRAY['admin','accountant','cashier','auditor']::text[]
            ))
          )
      )
    WHEN COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
      OR _user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_roles actor_role
        WHERE actor_role.user_id = auth.uid()
          AND actor_role.role = 'admin'::public.app_role
      ) THEN EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = _user_id AND ur.role = _role
      )
    ELSE false
  END;
$has_business_role$;

CREATE OR REPLACE FUNCTION public.has_permission(permission_code text, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $has_business_permission$
  SELECT CASE
    WHEN target_user_id IS NULL THEN false
    WHEN coalesce(auth.role(), '') = 'service_role' THEN EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role = ur.role::text
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = target_user_id
        AND p.code = permission_code
    )
    WHEN target_user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.business_members bm
        WHERE bm.user_id = target_user_id AND bm.status = 'active'
      ) THEN EXISTS (
        SELECT 1
        FROM public.business_members bm
        JOIN public.role_permissions rp
          ON rp.role = ANY(
            CASE WHEN bm.role = 'owner'
              THEN ARRAY['admin','accountant','cashier','auditor']::text[]
              ELSE ARRAY[bm.role]::text[]
            END
          )
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE bm.user_id = target_user_id
          AND bm.business_id = public.current_business_id()
          AND bm.status = 'active'
          AND p.code = permission_code
      )
    WHEN target_user_id = auth.uid() THEN EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role = ur.role::text
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = target_user_id
        AND p.code = permission_code
    )
    ELSE false
  END;
$has_business_permission$;

-- RPC-owner access is permissive only for the NOLOGIN function-owner role.
-- The restrictive tenant policy below still applies inside every RPC/trigger.
DO $rpc_policies$
DECLARE
  v_table record;
  v_has_business_id boolean;
BEGIN
  FOR v_table IN
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p')
      AND c.relrowsecurity
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies p
      WHERE p.schemaname='public'
        AND p.tablename=v_table.relname
        AND p.policyname='rpc_owner_access'
    ) THEN
      EXECUTE pg_catalog.format(
        'CREATE POLICY rpc_owner_access ON public.%I FOR ALL TO audit_ledger_rpc_owner USING (true) WITH CHECK (true)',
        v_table.relname
      );
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = pg_catalog.format('public.%I',v_table.relname)::regclass
        AND a.attname = 'business_id'
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) INTO v_has_business_id;

    IF v_has_business_id
       AND v_table.relname NOT IN ('business_members','business_invitations')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policies p
         WHERE p.schemaname='public'
           AND p.tablename=v_table.relname
           AND p.policyname='tenant_business_scope'
       ) THEN
      EXECUTE pg_catalog.format(
        'CREATE POLICY tenant_business_scope ON public.%I AS RESTRICTIVE FOR ALL TO public USING (business_id IS NULL OR (business_id = public.current_business_id() AND public.can_access_business(business_id))) WITH CHECK (business_id IS NULL OR (business_id = public.current_business_id() AND public.can_access_business(business_id)))',
        v_table.relname
      );
    END IF;
  END LOOP;
END;
$rpc_policies$;

-- The event trigger continues to enable RLS on future public tables and also
-- provisions the RPC-owner policy plus a tenant guard whenever business_id is
-- part of the table definition. business_members is deliberately excluded
-- from the tenant guard because membership administration must inspect the
-- other members of the same workspace.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog'
AS $rls_auto_enable$
DECLARE
  cmd record;
  v_table name;
  v_has_business_id boolean;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_catalog.pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name = 'public' THEN
      BEGIN
        SELECT c.relname INTO v_table
        FROM pg_catalog.pg_class c
        WHERE c.oid = cmd.objid;

        EXECUTE pg_catalog.format(
          'ALTER TABLE IF EXISTS %I.%I ENABLE ROW LEVEL SECURITY',
          cmd.schema_name,
          v_table
        );

        EXECUTE pg_catalog.format(
          'CREATE POLICY rpc_owner_access ON %I.%I FOR ALL TO audit_ledger_rpc_owner USING (true) WITH CHECK (true)',
          cmd.schema_name,
          v_table
        );

        SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = cmd.objid
            AND a.attname = 'business_id'
            AND a.attnum > 0
            AND NOT a.attisdropped
        ) INTO v_has_business_id;

        IF v_has_business_id AND v_table NOT IN ('business_members','business_invitations') THEN
          EXECUTE pg_catalog.format(
            'CREATE POLICY tenant_business_scope ON %I.%I AS RESTRICTIVE FOR ALL TO public USING (business_id IS NULL OR (business_id = public.current_business_id() AND public.can_access_business(business_id))) WITH CHECK (business_id IS NULL OR (business_id = public.current_business_id() AND public.can_access_business(business_id)))',
            cmd.schema_name,
            v_table
          );
        END IF;
      EXCEPTION
        WHEN duplicate_object THEN
          RAISE LOG 'rls_auto_enable: policies already exist for %', cmd.object_identity;
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to secure %', cmd.object_identity;
      END;
    END IF;
  END LOOP;
END;
$rls_auto_enable$;

-- Transfer existing public SECURITY DEFINER functions to a role that cannot
-- bypass RLS. DDL-only event-trigger functions remain owned by postgres.
DO $transfer_definers$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure::text AS signature
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname NOT IN ('rls_auto_enable','revoke_public_schema_anon_grants','secure_definer_function_owners','rpc_auth_user_exists','rpc_auth_user_email')
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s OWNER TO audit_ledger_rpc_owner',
      v_function.signature
    );
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET row_security = on',
      v_function.signature
    );
  END LOOP;
END;
$transfer_definers$;

-- Auth schema/function privileges are inherited from authenticated membership.

-- Future SECURITY DEFINER routines are automatically assigned the same
-- constrained owner after creation/replacement.
CREATE OR REPLACE FUNCTION public.secure_definer_function_owners()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog'
AS $secure_definer_function_owners$
DECLARE
  cmd record;
  v_signature text;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_catalog.pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE FUNCTION','ALTER FUNCTION')
      AND object_type = 'function'
      AND schema_name = 'public'
  LOOP
    SELECT p.oid::regprocedure::text
      INTO v_signature
    FROM pg_catalog.pg_proc p
    WHERE p.oid = cmd.objid
      AND p.prosecdef
      AND p.proname NOT IN ('rls_auto_enable','revoke_public_schema_anon_grants','secure_definer_function_owners','rpc_auth_user_exists','rpc_auth_user_email');

    IF v_signature IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %s OWNER TO audit_ledger_rpc_owner',
        v_signature
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %s SET row_security = on',
        v_signature
      );
    END IF;
  END LOOP;
END;
$secure_definer_function_owners$;

DROP EVENT TRIGGER IF EXISTS secure_public_security_definer_owners;
CREATE EVENT TRIGGER secure_public_security_definer_owners
  ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION','ALTER FUNCTION')
  EXECUTE FUNCTION public.secure_definer_function_owners();

-- Only postgres (the migration owner) can execute the DDL event-trigger
-- routines directly. They are not application RPC endpoints.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.secure_definer_function_owners() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.can_access_business(uuid) TO authenticated, audit_ledger_rpc_owner;
REVOKE ALL ON FUNCTION public.can_access_business(uuid) FROM PUBLIC, anon;

-- Auth schema access is inherited from authenticated membership above.

NOTIFY pgrst, 'reload schema';
