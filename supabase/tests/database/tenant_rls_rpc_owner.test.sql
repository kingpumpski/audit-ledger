CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(23);

CREATE OR REPLACE FUNCTION public.test_rpc_owner_event_trigger_guard()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $test_rpc_owner_event_trigger_guard$
  SELECT 1;
$test_rpc_owner_event_trigger_guard$;

SELECT extensions.ok(
  (SELECT p.proowner = 'audit_ledger_rpc_owner'::regrole
          AND p.proconfig @> ARRAY['row_security=on']
   FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.test_rpc_owner_event_trigger_guard()'::regprocedure),
  'future SECURITY DEFINER functions are safely reassigned with row security enabled'
);

DROP FUNCTION public.test_rpc_owner_event_trigger_guard();

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('b2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'tenant-a@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('b2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'tenant-b@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('b2000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'tenant-cashier@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname='audit_ledger_rpc_owner'
      AND NOT rolcanlogin
      AND NOT rolbypassrls
  ),
  'SECURITY DEFINER routines use a non-login, non-BYPASSRLS owner'
);

SELECT extensions.ok(
  has_schema_privilege('authenticated', 'auth', 'USAGE'),
  'authenticated role retains usage on the Supabase Auth schema'
);

SELECT extensions.ok(
  has_schema_privilege('audit_ledger_rpc_owner', 'auth', 'USAGE'),
  'constrained RPC owner retains usage on the Supabase Auth schema'
);

SELECT extensions.ok(
  has_function_privilege('audit_ledger_rpc_owner', 'auth.uid()', 'EXECUTE'),
  'constrained RPC owner can execute auth.uid()'
);

SELECT extensions.ok(
  has_function_privilege('audit_ledger_rpc_owner', 'public.rpc_auth_user_exists(uuid)', 'EXECUTE')
  AND has_function_privilege('audit_ledger_rpc_owner', 'public.rpc_auth_user_email(uuid)', 'EXECUTE')
  AND has_function_privilege('audit_ledger_rpc_owner', 'public.rpc_auth_user_email_confirmed(uuid,text)', 'EXECUTE')
  AND has_function_privilege('audit_ledger_rpc_owner', 'public.rpc_auth_user_full_name(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.rpc_auth_user_exists(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.rpc_auth_user_email(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.rpc_auth_user_email_confirmed(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.rpc_auth_user_full_name(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.rpc_auth_user_exists(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.rpc_auth_user_email(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.rpc_auth_user_email_confirmed(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.rpc_auth_user_full_name(uuid)', 'EXECUTE'),
  'Auth lookup helpers are executable only by the constrained RPC owner'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.prosecdef
      AND p.proname NOT IN ('rls_auto_enable','revoke_public_schema_anon_grants','secure_definer_function_owners','rpc_auth_user_exists','rpc_auth_user_email','rpc_auth_user_email_confirmed','rpc_auth_user_full_name')
      AND p.proowner <> 'audit_ledger_rpc_owner'::regrole
  ),
  'all application SECURITY DEFINER routines are owned by the constrained RPC role'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_policies
   WHERE schemaname='public'
     AND policyname='tenant_business_scope'
     AND tablename = ANY(ARRAY['chart_of_accounts','company_settings','credit_note_line_taxes','credit_note_lines','credit_notes','customer_credit_applications','customer_credit_refunds','customers','discounts','financial_completeness_attestations','inventory_count_adjustments','inventory_purchase_reversals','inventory_transactions','invoice_item_direct_costs','invoice_item_taxes','invoice_items','invoice_taxes','invoices','journal_entries','journal_lines','operating_expense_payments','operating_expense_refunds','operating_expense_reversals','operating_expenses','payment_clearing_settlements','payments','petty_cash_expense_reversals','petty_cash_transactions','product_price_history','products','receipts','sequences','taxes'])),
  33,
  'all 33 operational tables have restrictive tenant-scope policies'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_policies
   WHERE schemaname='public'
     AND policyname='rpc_owner_access'
     AND tablename = ANY(ARRAY['chart_of_accounts','company_settings','credit_note_line_taxes','credit_note_lines','credit_notes','customer_credit_applications','customer_credit_refunds','customers','discounts','financial_completeness_attestations','inventory_count_adjustments','inventory_purchase_reversals','inventory_transactions','invoice_item_direct_costs','invoice_item_taxes','invoice_items','invoice_taxes','invoices','journal_entries','journal_lines','operating_expense_payments','operating_expense_refunds','operating_expense_reversals','operating_expenses','payment_clearing_settlements','payments','petty_cash_expense_reversals','petty_cash_transactions','product_price_history','products','receipts','sequences','taxes'])),
  33,
  'the constrained RPC role has an explicit permissive policy on all operational tables'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM information_schema.columns
   WHERE table_schema='public'
     AND column_name='business_id'
     AND column_default LIKE '%current_business_id%'
     AND table_name = ANY(ARRAY['chart_of_accounts','company_settings','credit_note_line_taxes','credit_note_lines','credit_notes','customer_credit_applications','customer_credit_refunds','customers','discounts','financial_completeness_attestations','inventory_count_adjustments','inventory_purchase_reversals','inventory_transactions','invoice_item_direct_costs','invoice_item_taxes','invoice_items','invoice_taxes','invoices','journal_entries','journal_lines','operating_expense_payments','operating_expense_refunds','operating_expense_reversals','operating_expenses','payment_clearing_settlements','payments','petty_cash_expense_reversals','petty_cash_transactions','product_price_history','products','receipts','sequences','taxes'])),
  33,
  'all business-owned operational tables default to the active business'
);

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'test.tenant_a',
  public.create_business('Tenant A Test', 'small_business', 'Ghana', 'GHS', 'Africa/Accra')::text,
  true
);

SELECT extensions.is(
  public.current_business_id(),
  current_setting('test.tenant_a')::uuid,
  'a user with one active membership resolves that business without a claim'
);

SELECT extensions.ok(
  public.has_any_role(ARRAY['admin','accountant','cashier','auditor']::text[]),
  'an owner membership receives the expected application permissions'
);

SELECT public.set_business_member_access(
  current_setting('test.tenant_a')::uuid,
  'b2000000-0000-4000-8000-000000000003',
  'cashier',
  'active'
);

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000003', true);

SELECT extensions.is(
  public.current_business_id(),
  current_setting('test.tenant_a')::uuid,
  'a newly invited single-business member resolves the assigned workspace'
);

SELECT extensions.ok(
  public.has_any_role(ARRAY['cashier']::text[]),
  'business membership grants the assigned cashier permission'
);

SELECT extensions.ok(
  NOT public.has_any_role(ARRAY['admin']::text[]),
  'a cashier membership does not inherit administrator permissions'
);

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);

WITH inserted AS (
  INSERT INTO public.customers (code, name)
  VALUES ('TENANT-CUSTOMER', 'Tenant A Customer')
  RETURNING id
)
SELECT set_config('test.customer_a', (SELECT id::text FROM inserted), true);

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
SELECT set_config(
  'test.tenant_b',
  public.create_business('Tenant B Test', 'small_business', 'Ghana', 'GHS', 'Africa/Accra')::text,
  true
);

WITH inserted AS (
  INSERT INTO public.customers (code, name)
  VALUES ('TENANT-CUSTOMER', 'Tenant B Customer')
  RETURNING id
)
SELECT set_config('test.customer_b', (SELECT id::text FROM inserted), true);

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.customers),
  1,
  'direct customer reads are isolated to the active business'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.get_customer_account_balances(CURRENT_DATE, NULL)),
  1,
  'SECURITY DEFINER customer-balance RPCs are isolated by RLS'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.customers
   WHERE id=current_setting('test.customer_b')::uuid),
  0,
  'a business member cannot read another business customer by ID'
);

SELECT extensions.lives_ok(
  $tenant_write$
  DO $cross_tenant_write$
  BEGIN
    BEGIN
      INSERT INTO public.customers (code, name, business_id)
      VALUES ('CROSS-TENANT', 'Must be rejected', current_setting('test.tenant_b')::uuid);
      RAISE EXCEPTION 'cross-business write was not rejected';
    EXCEPTION
      WHEN insufficient_privilege THEN
        NULL;
    END;
  END;
  $cross_tenant_write$;
  $tenant_write$,
  'cross-business writes are rejected by the restrictive tenant policy'
);

SELECT set_config(
  'test.tenant_a_second',
  public.create_business('Tenant A Second Workspace', 'small_business', 'Ghana', 'GHS', 'Africa/Accra')::text,
  true
);

SELECT extensions.is(
  public.current_business_id(),
  NULL::uuid,
  'multiple memberships without an active claim fail closed'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'b2000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('active_business_id', current_setting('test.tenant_a'))
  )::text,
  true
);

SELECT extensions.is(
  public.current_business_id(),
  current_setting('test.tenant_a')::uuid,
  'a valid signed active-business claim selects exactly its membership'
);


RESET ROLE;
INSERT INTO public.user_roles (user_id, role, granted_by)
VALUES (
  'b2000000-0000-4000-8000-000000000002',
  'admin'::public.app_role,
  'b2000000-0000-4000-8000-000000000001'
);
UPDATE public.business_members
SET status='suspended'
WHERE business_id=current_setting('test.tenant_b')::uuid
  AND user_id='b2000000-0000-4000-8000-000000000002';

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'b2000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'app_metadata', '{}'::jsonb
  )::text,
  true
);
SET LOCAL ROLE authenticated;

SELECT extensions.is(
  public.current_business_id(),
  NULL::uuid,
  'a suspended member cannot fall back to legacy workspace through a global role'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.customers),
  0,
  'a suspended member with a legacy global role still cannot read operational data'
);

RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
