CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(9);

SELECT extensions.ok(
  to_regprocedure('public.set_business_member_access(uuid,uuid,text,text)') IS NOT NULL,
  'The audited business membership management RPC exists'
);

SELECT extensions.ok(
  (
    SELECT p.prosecdef
    FROM pg_proc p
    WHERE p.oid = 'public.set_business_member_access(uuid,uuid,text,text)'::regprocedure
  ),
  'Membership management runs as SECURITY DEFINER'
);

SELECT extensions.ok(
  (
    SELECT p.proconfig @> ARRAY['search_path=""']
    FROM pg_proc p
    WHERE p.oid = 'public.set_business_member_access(uuid,uuid,text,text)'::regprocedure
  ),
  'Membership management uses an empty search_path'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.set_business_member_access(uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'Authenticated callers can use the guarded membership RPC'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.set_business_member_access(uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'Anonymous callers cannot use the membership RPC'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl, acldefault('f', p.proowner))
    ) acl
    WHERE p.oid = 'public.set_business_member_access(uuid,uuid,text,text)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the membership RPC'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.business_members', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.business_members', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.business_members', 'DELETE'),
  'Authenticated clients cannot bypass the guarded RPC with direct membership writes'
);

SELECT extensions.ok(
  position(
    'final active owner' IN pg_get_functiondef(
      'public.set_business_member_access(uuid,uuid,text,text)'::regprocedure
    )
  ) > 0,
  'The RPC protects the final active owner'
);

SELECT extensions.ok(
  position(
    'business_member' IN pg_get_functiondef(
      'public.set_business_member_access(uuid,uuid,text,text)'::regprocedure
    )
  ) > 0,
  'Membership changes are written to the audit log'
);

SELECT * FROM extensions.finish();
ROLLBACK;
