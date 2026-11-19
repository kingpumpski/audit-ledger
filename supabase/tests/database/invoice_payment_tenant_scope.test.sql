CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(9);

INSERT INTO auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data
) VALUES (
  '15000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'invoice-tenant-scope@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb
);

INSERT INTO public.user_roles(user_id,role)
VALUES ('15000000-0000-4000-8000-000000000001','accountant');

INSERT INTO public.businesses(id,name,created_by)
VALUES
  ('15000000-0000-4000-8000-000000000010','Invoice tenant A','15000000-0000-4000-8000-000000000001'),
  ('15000000-0000-4000-8000-000000000020','Invoice tenant B','15000000-0000-4000-8000-000000000001');

INSERT INTO public.business_members(business_id,user_id,role,status,joined_at)
VALUES
  ('15000000-0000-4000-8000-000000000010','15000000-0000-4000-8000-000000000001','accountant','active',now()),
  ('15000000-0000-4000-8000-000000000020','15000000-0000-4000-8000-000000000001','accountant','active',now());

SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','15000000-0000-4000-8000-000000000001',
    'role','authenticated',
    'app_metadata',jsonb_build_object('active_business_id','15000000-0000-4000-8000-000000000010')
  )::text,
  true
);

INSERT INTO public.customers(id,code,name,business_id)
VALUES (
  '15000000-0000-4000-8000-000000000030',
  'INV-TENANT-A-CUSTOMER','Invoice tenant A customer',
  '15000000-0000-4000-8000-000000000010'
);

INSERT INTO public.invoices(
  id,invoice_number,customer_id,business_id,status,issue_date,
  subtotal,tax_amount,total_amount,amount_paid,balance_due
)
VALUES (
  '15000000-0000-4000-8000-000000000040',
  'INV-TENANT-A-001',
  '15000000-0000-4000-8000-000000000030',
  '15000000-0000-4000-8000-000000000010',
  'draft',CURRENT_DATE,100,0,100,0,100
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','15000000-0000-4000-8000-000000000001',
    'role','authenticated',
    'app_metadata',jsonb_build_object('active_business_id','15000000-0000-4000-8000-000000000020')
  )::text,
  true
);

SELECT extensions.lives_ok(
  $insert$ INSERT INTO public.customers(id,code,name,business_id)
     VALUES ('15000000-0000-4000-8000-000000000031',
       'INV-TENANT-A-CUSTOMER','Invoice tenant B customer',
       '15000000-0000-4000-8000-000000000020') $insert$,
  'Customer codes can be reused in a different business'
);

SELECT extensions.lives_ok(
  $insert$ INSERT INTO public.invoices(
       id,invoice_number,customer_id,business_id,status,issue_date,
       subtotal,tax_amount,total_amount,amount_paid,balance_due
     ) VALUES (
       '15000000-0000-4000-8000-000000000041',
       'INV-TENANT-A-001',
       '15000000-0000-4000-8000-000000000031',
       '15000000-0000-4000-8000-000000000020',
       'draft',CURRENT_DATE,100,0,100,0,100
     ) $insert$,
  'Invoice numbers can be reused in a different business'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer FROM pg_constraint
    WHERE conname IN (
      'invoices_invoice_number_key','payments_payment_number_key',
      'receipts_receipt_number_key','journal_entries_entry_number_key',
      'journal_entries_source_unique','customers_code_key','products_sku_key',
      'chart_of_accounts_code_key','sequences_pkey'
    )
  ),
  0,
  'Global unique constraints are replaced by business-scoped unique indexes'
);

SELECT extensions.throws_ok(
  $$ SELECT public.create_invoice_draft(
    '15000000-0000-4000-8000-000000000030',
    CURRENT_DATE,NULL,'Cross-business draft',NULL,false,
    100,0,0,100,
    '[{"description":"Cross-business line","quantity":1,"unit_price":100,"discount_type":null,"discount_value":0,"tax_rate":0,"tax_amount":0,"line_total":100,"sort_order":0,"tax_breakdown":[]}]'::jsonb
  ) $$,
  'P0001',
  'A valid customer is required to create an invoice',
  'Invoice draft RPC rejects a customer from another business'
);

SELECT extensions.throws_ok(
  $$ SELECT public.issue_invoice('15000000-0000-4000-8000-000000000040') $$,
  'P0001',
  'Invoice not found',
  'Invoice issuance RPC cannot issue another business invoice'
);

SELECT extensions.throws_ok(
  $$ SELECT public.record_invoice_payment(
    '15000000-0000-4000-8000-000000000040',
    '15000000-0000-4000-8000-000000000030',
    10,'cash','15000000-0000-4000-8000-000000000050',NULL,NULL
  ) $$,
  '42501',
  'Invoice not found for the selected customer in the active business',
  'Payment RPC rejects an invoice/customer pair from another business'
);

SELECT extensions.throws_ok(
  $$ SELECT public.create_receipt_with_payment(
    '15000000-0000-4000-8000-000000000030',
    NULL,NULL,10,'cash','15000000-0000-4000-8000-000000000060',
    NULL,NULL,NULL,NULL,NULL,NULL
  ) $$,
  '42501',
  'The selected customer does not belong to the active business',
  'Standalone receipt RPC rejects a customer from another business'
);

SELECT extensions.is(
  public.get_next_sequence('invoice'),
  'INV-000001',
  'A new business lazily receives its own invoice sequence'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','15000000-0000-4000-8000-000000000001',
    'role','authenticated',
    'app_metadata',jsonb_build_object('active_business_id','15000000-0000-4000-8000-000000000010')
  )::text,
  true
);

SELECT extensions.is(
  public.get_next_sequence('invoice'),
  'INV-000001',
  'Another business has an independent invoice sequence'
);

SELECT * FROM extensions.finish();
ROLLBACK;
