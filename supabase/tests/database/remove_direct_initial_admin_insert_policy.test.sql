CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(3);

DELETE FROM public.user_roles;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES (
  'b4000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'direct-admin-policy@example.invalid',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb
);

SELECT set_config('request.jwt.claim.sub', 'b4000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$ INSERT INTO public.user_roles (user_id, role, granted_by)
     VALUES (
       'b4000000-0000-4000-8000-000000000001',
       'admin'::public.app_role,
       'b4000000-0000-4000-8000-000000000001'
     ) $$,
  '42501',
  NULL,
  'Authenticated users cannot bypass the guarded initial-admin RPC with a direct role insert'
);

RESET ROLE;

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_roles'
      AND policyname = 'First user can claim admin'
  ),
  'The permissive first-user direct-insert policy is removed'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_roles'
      AND policyname = 'Authenticated admins can manage roles'
      AND cmd = 'ALL'
      AND roles @> ARRAY['authenticated']::name[]
  ),
  'The existing authenticated-admin role-management policy remains available'
);

SELECT * FROM extensions.finish();
ROLLBACK;
