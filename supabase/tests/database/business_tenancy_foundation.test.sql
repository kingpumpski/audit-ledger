CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(12);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('b1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'business-owner@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('b1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'other-business@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

SELECT extensions.ok(
  to_regclass('public.businesses') IS NOT NULL,
  'Business workspace table exists'
);
SELECT extensions.ok(
  to_regclass('public.business_members') IS NOT NULL,
  'Business membership table exists'
);
SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.businesses'::regclass),
  'Business workspace table has RLS enabled'
);
SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.business_members'::regclass),
  'Business membership table has RLS enabled'
);
SELECT extensions.ok(
  has_function_privilege('authenticated', 'public.create_business(text,text,text,text,text)', 'EXECUTE'),
  'Authenticated users can create their own business through the guarded RPC'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.create_business(text,text,text,text,text)', 'EXECUTE'),
  'Anonymous users cannot create businesses'
);

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'test.business_id',
  public.create_business('Market Trader Test', 'market_trader', 'Ghana', 'GHS', 'Africa/Accra')::text,
  true
);

SELECT extensions.ok(
  public.is_business_member(current_setting('test.business_id')::uuid),
  'The creator is an active member of the new business'
);
SELECT extensions.ok(
  public.has_business_role(current_setting('test.business_id')::uuid, ARRAY['owner']),
  'The creator receives the owner role'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.businesses
   WHERE id=current_setting('test.business_id')::uuid),
  1,
  'A business owner can read their own business'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.business_members
   WHERE business_id=current_setting('test.business_id')::uuid),
  1,
  'A business owner can read their own membership'
);

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
SELECT extensions.ok(
  NOT public.is_business_member(current_setting('test.business_id')::uuid),
  'A user outside the business is not a member'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.businesses
   WHERE id=current_setting('test.business_id')::uuid),
  0,
  'A user outside the business cannot read its workspace'
);

RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
