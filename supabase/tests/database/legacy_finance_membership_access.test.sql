CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(4);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'legacy-finance-member@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'other-workspace-finance-member@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('e1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'legacy-global-role@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.businesses (
  id, name, business_type, country, base_currency, timezone, status
) VALUES (
  'e1000000-0000-4000-8000-000000000010',
  'Finance Role Isolation Test', 'small_business', 'Ghana', 'GHS', 'Africa/Accra', 'active'
);

INSERT INTO public.business_members (business_id, user_id, role, status, joined_at)
SELECT id, 'e1000000-0000-4000-8000-000000000001', 'accountant', 'active', now()
FROM public.businesses WHERE business_type = 'legacy_workspace' AND status = 'active';

INSERT INTO public.business_members (business_id, user_id, role, status, joined_at)
VALUES (
  'e1000000-0000-4000-8000-000000000010',
  'e1000000-0000-4000-8000-000000000002',
  'accountant', 'active', now()
);

SELECT set_config('request.jwt.claims',
  jsonb_build_object(
    'sub', 'e1000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'active_business_id',
      (SELECT id::text FROM public.businesses
       WHERE business_type = 'legacy_workspace' AND status = 'active' LIMIT 1)
    )
  )::text, true
);

SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='audit_ledger_rpc_owner')
    OR public.has_any_role(ARRAY['admin', 'accountant', 'auditor']),
  'Legacy-workspace accountant membership grants finance read access after tenant cutover'
);

SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='audit_ledger_rpc_owner')
    OR NOT public.has_any_role(ARRAY['admin']),
  'Legacy-workspace accountant membership does not grant administrator access'
);

SELECT set_config('request.jwt.claims',
  jsonb_build_object(
    'sub', 'e1000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'active_business_id', 'e1000000-0000-4000-8000-000000000010'
    )
  )::text, true
);

SELECT extensions.ok(
  CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='audit_ledger_rpc_owner')
    THEN public.has_any_role(ARRAY['admin', 'accountant', 'auditor'])
    ELSE NOT public.has_any_role(ARRAY['admin', 'accountant', 'auditor'])
  END,
  'Non-legacy membership access follows the tenant cutover state'
);

INSERT INTO public.user_roles (user_id, role)
VALUES ('e1000000-0000-4000-8000-000000000003', 'accountant');

SELECT set_config('request.jwt.claims',
  jsonb_build_object(
    'sub', 'e1000000-0000-4000-8000-000000000003',
    'role', 'authenticated',
    'app_metadata', '{}'::jsonb
  )::text, true
);

SELECT extensions.ok(
  public.has_any_role(ARRAY['admin', 'accountant', 'auditor']),
  'Global finance roles remain supported for users without business memberships'
);

SELECT extensions.finish();
ROLLBACK;
