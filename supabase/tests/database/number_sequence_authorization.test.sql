CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(6);

SELECT extensions.ok(
  has_function_privilege('authenticated', 'public.get_next_sequence(text)', 'EXECUTE'),
  'Authenticated application clients retain the sequence RPC'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.get_next_sequence(text)', 'EXECUTE'),
  'Anonymous clients cannot allocate sequence numbers'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p,
         LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = 'public.get_next_sequence(text)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot allocate sequence numbers'
);

SELECT extensions.ok(
  position('auth.uid()' in pg_get_functiondef('public.get_next_sequence(text)'::regprocedure)) > 0,
  'Sequence allocation requires an authenticated identity'
);

SELECT extensions.ok(
  position('has_any_role(ARRAY[''admin'', ''accountant'', ''cashier'']' in pg_get_functiondef('public.get_next_sequence(text)'::regprocedure)) > 0,
  'Transaction sequences enforce the operational role allow-list'
);

SELECT extensions.ok(
  position('has_any_role(ARRAY[''admin'', ''accountant'']' in pg_get_functiondef('public.get_next_sequence(text)'::regprocedure)) > 0,
  'Master-data sequences exclude cashiers and auditors'
);

SELECT * FROM extensions.finish();
ROLLBACK;
