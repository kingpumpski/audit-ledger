CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(14);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('b2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'role-self@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('b2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'role-other@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('b2000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'role-admin@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.user_roles (id, user_id, role, granted_by, granted_at) VALUES
  ('b2100000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'cashier', NULL, now()),
  ('b2100000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'accountant', NULL, now()),
  ('b2100000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000003', 'admin', NULL, now());

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT extensions.is(
  public.get_user_role('b2000000-0000-4000-8000-000000000001'::uuid),
  'cashier'::public.app_role,
  'A user can retrieve their own role'
);
SELECT extensions.is(
  public.get_user_role('b2000000-0000-4000-8000-000000000002'::uuid),
  NULL::public.app_role,
  'A non-admin cannot retrieve another user role'
);
SELECT extensions.ok(
  public.has_any_role('b2000000-0000-4000-8000-000000000001'::uuid),
  'A user can check whether they have a role'
);
SELECT extensions.ok(
  NOT public.has_any_role('b2000000-0000-4000-8000-000000000002'::uuid),
  'A non-admin cannot enumerate another user role presence'
);
SELECT extensions.ok(
  public.has_role('b2000000-0000-4000-8000-000000000001'::uuid, 'cashier'::public.app_role),
  'A user can check their own specific role'
);
SELECT extensions.ok(
  NOT public.has_role('b2000000-0000-4000-8000-000000000002'::uuid, 'accountant'::public.app_role),
  'A non-admin cannot check another user specific role'
);

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000003', true);
SELECT extensions.is(
  public.get_user_role('b2000000-0000-4000-8000-000000000002'::uuid),
  'accountant'::public.app_role,
  'An administrator can retrieve another user role'
);
SELECT extensions.ok(
  public.has_any_role('b2000000-0000-4000-8000-000000000002'::uuid),
  'An administrator can check another user role presence'
);
SELECT extensions.ok(
  public.has_role('b2000000-0000-4000-8000-000000000002'::uuid, 'accountant'::public.app_role),
  'An administrator can check another user specific role'
);

RESET ROLE;
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.get_user_role(uuid)', 'EXECUTE'),
  'Anonymous users cannot execute role lookup'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.has_any_role(uuid)', 'EXECUTE'),
  'Anonymous users cannot execute role-presence lookup'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.has_role(uuid,public.app_role)', 'EXECUTE'),
  'Anonymous users cannot execute specific-role lookup'
);
SELECT extensions.ok(
  has_function_privilege('authenticated', 'public.get_user_role(uuid)', 'EXECUTE'),
  'Authenticated users retain the self-role RPC grant'
);
SELECT extensions.ok(
  has_function_privilege('authenticated', 'public.has_any_role(uuid)', 'EXECUTE'),
  'Authenticated users retain the self-role-presence RPC grant'
);

SELECT * FROM extensions.finish();
ROLLBACK;
