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
GRANT USAGE ON SCHEMA auth, extensions TO audit_ledger_rpc_owner;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO audit_ledger_rpc_owner;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO audit_ledger_rpc_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO audit_ledger_rpc_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO audit_ledger_rpc_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO audit_ledger_rpc_owner;
GRANT SELECT ON auth.users TO audit_ledger_rpc_owner;
GRANT USAGE ON ALL TYPES IN SCHEMA public TO audit_ledger_rpc_owner;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO audit_ledger_rpc_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO audit_ledger_rpc_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO audit_ledger_rpc_owner;

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
       AND v_table.relname <> 'business_members'
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

        IF v_has_business_id AND v_table <> 'business_members' THEN
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
      AND p.proname NOT IN ('rls_auto_enable','secure_definer_function_owners')
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
      AND p.proname NOT IN ('rls_auto_enable','secure_definer_function_owners');

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

NOTIFY pgrst, 'reload schema';
