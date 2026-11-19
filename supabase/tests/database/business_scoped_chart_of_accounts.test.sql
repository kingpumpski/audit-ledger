CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(10);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('e5000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'chart-owner-one@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('e5000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'chart-owner-two@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.businesses (
  id, name, business_type, country, base_currency, timezone, status
) VALUES
  ('e5000000-0000-4000-8000-000000000010',
   'Chart Workspace One', 'small_business', 'Ghana', 'GHS', 'Africa/Accra', 'active'),
  ('e5000000-0000-4000-8000-000000000020',
   'Chart Workspace Two', 'small_business', 'Ghana', 'USD', 'Africa/Accra', 'active');

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', 'e5000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text,
  true
);
SELECT set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', true);

INSERT INTO public.business_members (business_id, user_id, role, status, joined_at)
VALUES (
  'e5000000-0000-4000-8000-000000000010',
  'e5000000-0000-4000-8000-000000000001',
  'owner', 'active', now()
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', 'e5000000-0000-4000-8000-000000000002', 'role', 'authenticated')::text,
  true
);
SELECT set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);

INSERT INTO public.business_members (business_id, user_id, role, status, joined_at)
VALUES (
  'e5000000-0000-4000-8000-000000000020',
  'e5000000-0000-4000-8000-000000000002',
  'owner', 'active', now()
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.chart_of_accounts'::regclass
      AND conname = 'chart_of_accounts_code_key'
  ),
  'Chart account codes are no longer globally unique across businesses'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.chart_of_accounts
   WHERE business_id = 'e5000000-0000-4000-8000-000000000010'
     AND code IN ('1200', '4900', '6500')),
  3,
  'The first new business receives its own inventory and count variance accounts'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.chart_of_accounts
   WHERE business_id = 'e5000000-0000-4000-8000-000000000020'
     AND code IN ('1200', '4900', '6500')),
  3,
  'A second new business receives the same default account codes independently'
);

SELECT extensions.ok(
  (SELECT count(*) > 0 FROM public.chart_of_accounts
   WHERE business_id = 'e5000000-0000-4000-8000-000000000010'
     AND is_system = true),
  'The new business receives the standard system chart, not only the three inventory accounts'
);

SELECT extensions.is(
  (SELECT count(DISTINCT id)::integer FROM public.chart_of_accounts
   WHERE code = '1200'
     AND business_id IN (
       'e5000000-0000-4000-8000-000000000010',
       'e5000000-0000-4000-8000-000000000020'
     )),
  2,
  'Identical account codes have separate account identities per business'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.chart_of_accounts
   WHERE business_id = 'e5000000-0000-4000-8000-000000000010'
     AND code = '1200' AND currency = 'GHS'),
  1,
  'The first business chart uses its configured GHS currency'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.chart_of_accounts
   WHERE business_id = 'e5000000-0000-4000-8000-000000000020'
     AND code = '1200' AND currency = 'USD'),
  1,
  'The second business chart uses its configured USD currency'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM public.chart_of_accounts child
   JOIN public.chart_of_accounts parent ON parent.id = child.parent_id
   WHERE child.business_id = 'e5000000-0000-4000-8000-000000000010'
     AND parent.business_id <> child.business_id),
  0,
  'Cloned account hierarchy never points into another business'
);

SELECT extensions.ok(
  (SELECT count(*) > 0 FROM public.audit_logs
   WHERE business_id = 'e5000000-0000-4000-8000-000000000010'
     AND entity_type = 'chart_of_accounts'
     AND action = 'create')
  AND
  (SELECT count(*) > 0 FROM public.audit_logs
   WHERE business_id = 'e5000000-0000-4000-8000-000000000020'
     AND entity_type = 'chart_of_accounts'
     AND action = 'create'),
  'Default account creation remains auditable for each business'
);

SELECT extensions.throws_ok(
  $sql$
    INSERT INTO public.chart_of_accounts (
      business_id, code, name, account_type, currency, is_system, is_active
    ) VALUES (
      'e5000000-0000-4000-8000-000000000010',
      '1200', 'Duplicate inventory account', 'asset', 'GHS', true, true
    )
  $sql$,
  '23505',
  NULL,
  'Account codes remain unique within an individual business'
);

SELECT * FROM extensions.finish();
ROLLBACK;
