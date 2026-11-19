CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(2);

INSERT INTO auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data
) VALUES (
  'ca200000-0000-4000-8000-000000000009','authenticated','authenticated',
  'receivables-tenant-scope@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb
);
INSERT INTO public.user_roles(user_id,role)
VALUES ('ca200000-0000-4000-8000-000000000009','accountant');
INSERT INTO public.business_members(business_id,user_id,role,status,joined_at)
SELECT public.legacy_business_id(),'ca200000-0000-4000-8000-000000000009','accountant','active',now();

SELECT set_config('request.jwt.claim.sub','ca200000-0000-4000-8000-000000000009',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','ca200000-0000-4000-8000-000000000009',
    'role','authenticated',
    'app_metadata',jsonb_build_object('active_business_id',public.legacy_business_id()::text)
  )::text,
  true
);

INSERT INTO public.businesses(id,name,created_by)
VALUES(
  'ca200000-0000-4000-8000-000000000010',
  'Unassigned receivables tenant test',
  'ca200000-0000-4000-8000-000000000009'
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','ca200000-0000-4000-8000-000000000009',
    'role','authenticated',
    'app_metadata',jsonb_build_object('active_business_id','ca200000-0000-4000-8000-000000000010')
  )::text,
  true
);

SELECT extensions.throws_ok(
  $receivables_scope$ SELECT * FROM public.get_customer_account_balances(CURRENT_DATE) $receivables_scope$,
  '42501',
  'You are not authorized to view customer account balances',
  'Receivables RPC rejects an active-business claim without membership'
);
SELECT extensions.throws_ok(
  $customer_credit_scope$ SELECT * FROM public.get_customer_credit_balances('ca200000-0000-4000-8000-000000000099') $customer_credit_scope$,
  '42501',
  'You are not authorized to view customer credit balances',
  'Customer-credit RPC rejects an active-business claim without membership'
);

SELECT * FROM extensions.finish();
ROLLBACK;
