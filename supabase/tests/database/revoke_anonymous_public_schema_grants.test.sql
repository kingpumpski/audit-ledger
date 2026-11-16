CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;
SELECT extensions.plan(13);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.customers', 'SELECT'),
  'Anonymous clients cannot read customer records'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.invoices', 'INSERT'),
  'Anonymous clients cannot insert invoices'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.user_mfa', 'SELECT'),
  'Anonymous clients cannot read MFA records'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'Anonymous clients cannot execute public-schema functions'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND (
        has_sequence_privilege('anon', c.oid, 'USAGE')
        OR has_sequence_privilege('anon', c.oid, 'SELECT')
        OR has_sequence_privilege('anon', c.oid, 'UPDATE')
      )
  ),
  'Anonymous clients cannot use public-schema sequences'
);

SELECT extensions.ok(
  has_table_privilege('authenticated', 'public.customers', 'SELECT'),
  'Authenticated users retain customer read privileges subject to RLS'
);
SELECT extensions.ok(
  has_table_privilege('authenticated', 'public.invoices', 'INSERT'),
  'Authenticated users retain invoice insert privileges subject to RLS'
);
SELECT extensions.ok(
  has_function_privilege('authenticated', 'public.get_customer_account_balances(date,uuid)', 'EXECUTE'),
  'Authenticated users retain the customer balance RPC'
);

SELECT extensions.ok(
  has_function_privilege('authenticated', 'public.create_invoice_draft(uuid,date,date,text,text,boolean,numeric,numeric,numeric,numeric,jsonb)', 'EXECUTE'),
  'Authenticated users retain the atomic invoice draft RPC'
);
SELECT extensions.ok(
  has_function_privilege('authenticated', 'public.record_invoice_payment(uuid,uuid,numeric,payment_method,uuid,text,text)', 'EXECUTE'),
  'Authenticated users retain the invoice payment RPC'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoices'
      AND policyname = 'Admins, accountants, and cashiers can create invoices'
      AND roles @> ARRAY['authenticated']::name[]
      AND NOT roles @> ARRAY['public']::name[]
  ),
  'Invoice creation policy is limited to authenticated sessions'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_price_history'
      AND policyname = 'Admins can insert price history'
      AND roles @> ARRAY['authenticated']::name[]
      AND NOT roles @> ARRAY['public']::name[]
  ),
  'Product price history insertion policy is limited to authenticated sessions'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    WHERE d.defaclnamespace = 'public'::regnamespace
      AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
      AND acl.grantee IN (
        0,
        (SELECT oid FROM pg_roles WHERE rolname = 'anon')
      )
      AND (
        (d.defaclobjtype = 'r' AND acl.privilege_type IN
          ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
        OR (d.defaclobjtype = 'S' AND acl.privilege_type IN ('USAGE','SELECT','UPDATE'))
        OR (d.defaclobjtype = 'f' AND acl.privilege_type = 'EXECUTE')
      )
  ),
  'Future objects created by the migration owner do not grant PUBLIC or anon access by default'
);

SELECT * FROM extensions.finish();
ROLLBACK;
