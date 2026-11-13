CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(6);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('f1000000-0000-4000-8000-000000000001','authenticated','authenticated',
   'tax-snapshot-accountant@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb),
  ('f1000000-0000-4000-8000-000000000002','authenticated','authenticated',
   'tax-snapshot-cashier@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb);

INSERT INTO public.user_roles(user_id, role) VALUES
  ('f1000000-0000-4000-8000-000000000001','accountant'),
  ('f1000000-0000-4000-8000-000000000002','cashier');

INSERT INTO public.customers(code,name)
VALUES ('TAX-SNAPSHOT-CUSTOMER','Tax snapshot test customer');

INSERT INTO public.invoices (
  invoice_number, customer_id, status, issue_date, subtotal,
  tax_amount, total_amount, balance_due
)
SELECT 'INV-TAX-SNAPSHOT-001', id, 'draft', CURRENT_DATE, 100, 15, 115, 115
FROM public.customers WHERE code='TAX-SNAPSHOT-CUSTOMER';

INSERT INTO public.invoice_items (
  invoice_id, description, quantity, unit_price, tax_rate, tax_amount, line_total
)
SELECT id, 'Tax snapshot test line', 1, 100, 15, 15, 115
FROM public.invoices WHERE invoice_number='INV-TAX-SNAPSHOT-001';

SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

INSERT INTO public.taxes (
  code, name, type, rate, is_compound, is_active,
  liability_account_id, effective_from
)
SELECT 'TAX-SNAPSHOT-001','Tax snapshot VAT','vat',15,false,true,coa.id,CURRENT_DATE
FROM public.chart_of_accounts coa WHERE coa.code='2100';

INSERT INTO public.invoice_taxes (
  invoice_id, tax_id, tax_rate, taxable_amount, tax_amount, liability_account_id
)
SELECT i.id, t.id, t.rate, 100, 15, t.liability_account_id
FROM public.invoices i
JOIN public.taxes t ON t.code='TAX-SNAPSHOT-001'
WHERE i.invoice_number='INV-TAX-SNAPSHOT-001';

SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

INSERT INTO public.invoice_item_taxes (
  invoice_id, invoice_item_id, tax_id, tax_name, tax_code,
  tax_rate, is_compound, tax_order, taxable_amount, tax_amount,
  liability_account_id
)
SELECT i.id, ii.id, t.id, t.name, t.code, t.rate, t.is_compound,
       0, 100, 15, t.liability_account_id
FROM public.invoices i
JOIN public.invoice_items ii ON ii.invoice_id=i.id
JOIN public.taxes t ON t.code='TAX-SNAPSHOT-001'
WHERE i.invoice_number='INV-TAX-SNAPSHOT-001';

SELECT extensions.is(
  (SELECT round(sum(tax_amount),2) FROM public.invoice_item_taxes
   WHERE invoice_id=(SELECT id FROM public.invoices WHERE invoice_number='INV-TAX-SNAPSHOT-001')),
  15.00::numeric,
  'Invoice line preserves its exact tax amount and liability allocation'
);

INSERT INTO public.invoices (
  invoice_number, customer_id, status, issue_date, subtotal,
  tax_amount, total_amount, balance_due
)
SELECT 'INV-TAX-SNAPSHOT-002', id, 'draft', CURRENT_DATE, 100, 15, 115, 115
FROM public.customers WHERE code='TAX-SNAPSHOT-CUSTOMER';

INSERT INTO public.invoice_items (
  invoice_id, description, quantity, unit_price, tax_rate, tax_amount, line_total
)
SELECT id, 'Second draft invoice line', 1, 100, 15, 15, 115
FROM public.invoices WHERE invoice_number='INV-TAX-SNAPSHOT-002';

SELECT extensions.throws_ok(
  $$ UPDATE public.invoice_item_taxes SET tax_rate=99
     WHERE invoice_id=(SELECT id FROM public.invoices WHERE invoice_number='INV-TAX-SNAPSHOT-001') $$,
  'P0001',
  'Tax snapshot must match the active authoritative tax definition',
  'A client cannot rewrite the authoritative tax rate in a line snapshot'
);

SELECT extensions.throws_ok(
  $$ INSERT INTO public.invoice_item_taxes (
       invoice_id, invoice_item_id, tax_id, tax_name, tax_code,
       tax_rate, is_compound, tax_order, taxable_amount, tax_amount,
       liability_account_id
     )
     SELECT i2.id, ii1.id, t.id, t.name, t.code, t.rate, t.is_compound,
            0, 100, 15, t.liability_account_id
     FROM public.invoices i2
     JOIN public.invoice_items ii1 ON ii1.invoice_id = (
       SELECT id FROM public.invoices WHERE invoice_number='INV-TAX-SNAPSHOT-001'
     )
     CROSS JOIN public.taxes t
     WHERE i2.invoice_number='INV-TAX-SNAPSHOT-002'
       AND t.code='TAX-SNAPSHOT-001' $$,
  'P0001',
  'Tax snapshot invoice line does not belong to the specified invoice',
  'A tax snapshot cannot attach another invoice line to a different invoice'
);

UPDATE public.invoices SET status='issued'
WHERE invoice_number='INV-TAX-SNAPSHOT-001';

SELECT extensions.throws_ok(
  $$ UPDATE public.invoice_item_taxes SET tax_amount=14
     WHERE invoice_id=(SELECT id FROM public.invoices WHERE invoice_number='INV-TAX-SNAPSHOT-001') $$,
  'P0001',
  'Tax snapshots are immutable after an invoice is issued',
  'Issued invoice tax snapshots cannot be edited'
);

SELECT extensions.throws_ok(
  $$ INSERT INTO public.invoice_item_taxes (
       invoice_id, invoice_item_id, tax_id, tax_name, tax_code,
       tax_rate, is_compound, tax_order, taxable_amount, tax_amount,
       liability_account_id
     )
     SELECT i.id, ii.id, t.id, t.name, t.code, t.rate, false,
            1, 100, 15, t.liability_account_id
     FROM public.invoices i
     JOIN public.invoice_items ii ON ii.invoice_id=i.id
     JOIN public.taxes t ON t.code='TAX-SNAPSHOT-001'
     WHERE i.invoice_number='INV-TAX-SNAPSHOT-001' $$,
  'P0001',
  'Tax snapshots are immutable after an invoice is issued',
  'Issued invoice cannot receive additional tax snapshot rows'
);

SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'test.invoice_item_tax_snapshot_visible_count',
  (SELECT count(*)::text FROM public.invoice_item_taxes),
  true
);
RESET ROLE;
SELECT extensions.is(
  current_setting('test.invoice_item_tax_snapshot_visible_count')::integer,
  0,
  'Cashier cannot read finance-only tax allocation snapshots'
);

SELECT * FROM extensions.finish();
ROLLBACK;
