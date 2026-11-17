CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(8);

-- The isolated migration test database must begin with no claimed roles.
DELETE FROM public.user_roles;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('b3000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'bootstrap-first@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('b3000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'bootstrap-second@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

SELECT set_config('request.jwt.claim.sub', 'b3000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT extensions.ok(
  public.is_first_user(),
  'An authenticated user sees initial setup only while no roles exist'
);
SELECT extensions.ok(
  public.claim_initial_admin(),
  'The first authenticated user can claim the initial administrator role'
);
SELECT extensions.ok(
  public.has_role('admin'::public.app_role),
  'The first claimant receives the administrator role'
);
SELECT extensions.ok(
  NOT public.is_first_user(),
  'Initial setup closes immediately after the first role is created'
);

SELECT set_config('request.jwt.claim.sub', 'b3000000-0000-4000-8000-000000000002', true);
SELECT extensions.ok(
  NOT public.claim_initial_admin(),
  'A subsequent user cannot claim the initial administrator role'
);
SELECT extensions.ok(
  NOT public.has_role('admin'::public.app_role),
  'A subsequent user does not receive administrator privileges'
);

RESET ROLE;
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.is_first_user()', 'EXECUTE'),
  'Anonymous users cannot inspect initial administrator setup state'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.claim_initial_admin()', 'EXECUTE'),
  'Anonymous users cannot claim the initial administrator role'
);

SELECT * FROM extensions.finish();
ROLLBACK;
