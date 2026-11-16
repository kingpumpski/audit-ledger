CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(7);

SELECT extensions.ok(
  has_function_privilege('authenticated', 'public.assign_user_role(uuid,public.app_role,uuid)', 'EXECUTE'),
  'Authenticated clients retain the role-management RPC entry point'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.assign_user_role(uuid,public.app_role,uuid)', 'EXECUTE'),
  'Anonymous clients cannot execute role assignment'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p,
         LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = 'public.assign_user_role(uuid,public.app_role,uuid)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute role assignment'
);

SELECT extensions.ok(
  position('auth.uid()' in pg_get_functiondef('public.assign_user_role(uuid,public.app_role,uuid)'::regprocedure)) > 0,
  'Role assignment derives the actor from the authenticated identity'
);

SELECT extensions.ok(
  position('has_any_role(ARRAY[''admin'']' in pg_get_functiondef('public.assign_user_role(uuid,public.app_role,uuid)'::regprocedure)) > 0,
  'Role assignment requires administrator authorization'
);

SELECT extensions.ok(
  position('granted_by_user IS DISTINCT FROM v_actor' in pg_get_functiondef('public.assign_user_role(uuid,public.app_role,uuid)'::regprocedure)) > 0,
  'Caller-supplied granting identity cannot impersonate another user'
);

SELECT extensions.ok(
  position('USING ERRCODE = ''42501''' in pg_get_functiondef('public.assign_user_role(uuid,public.app_role,uuid)'::regprocedure)) > 0,
  'Unauthorized role assignment fails with insufficient privilege'
);

SELECT * FROM extensions.finish();
ROLLBACK;
