CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(8);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES (
  'f2000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'atomic-invoice-accountant@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb
);

INSERT INTO public.user_roles(user_id, role)
VALUES ('f2000000-0000-4000-8000-000000000001','accountant');

INSERT INTO public.customers(code,name)
VALUES ('ATOMIC-INVOICE-CUSTOMER','Atomic invoice test customer');

SELECT set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

SELECT extensions.lives_ok(
  $$
    SELECT public.create_invoice_draft(
      (SELECT id FROM public.customers WHERE code='ATOMIC-INVOICE-CUSTOMER'),
      CURRENT_DATE, NULL, 'Atomic draft test', NULL, false,
      100, 0, 0, 100,
      '[{"description":"Atomic line","quantity":2,"unit_price":50,"discount_type":null,"discount_value":0,"tax_rate":0,"tax_amount":0,"line_total":100,"sort_order":0,"tax_breakdown":[]}]'::jsonb
    )
  $$,
  'A valid invoice draft and its line are created in one transaction'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.invoices i
    JOIN public.invoice_items ii ON ii.invoice_id=i.id
    WHERE i.customer_id=(SELECT id FROM public.customers WHERE code='ATOMIC-INVOICE-CUSTOMER')
      AND i.notes='Atomic draft test'
      AND i.status='draft'
  ),
  1,
  'The committed draft has its complete invoice line'
);

INSERT INTO public.taxes (
  code, name, type, rate, is_compound, is_active,
  liability_account_id, effective_from
)
SELECT 'ATOMIC-ZERO-TAX','Atomic zero-rated tax','vat',0,false,true,coa.id,CURRENT_DATE
FROM public.chart_of_accounts coa
WHERE coa.code='2100' AND coa.account_type='liability' AND coa.is_active
LIMIT 1;

SELECT extensions.lives_ok(
  $
    SELECT public.create_invoice_draft(
      (SELECT id FROM public.customers WHERE code='ATOMIC-INVOICE-CUSTOMER'),
      CURRENT_DATE, NULL, 'Atomic zero-rated tax', NULL, false,
      100, 0, 0, 100,
      jsonb_build_array(jsonb_build_object(
        'description','Zero-rated line',
        'quantity',1,
        'unit_price',100,
        'discount_type',NULL,
        'discount_value',0,
        'tax_rate',0,
        'tax_amount',0,
        'line_total',100,
        'sort_order',0,
        'tax_breakdown',jsonb_build_array(jsonb_build_object(
          'tax_id',(SELECT id FROM public.taxes WHERE code='ATOMIC-ZERO-TAX'),
          'name','Atomic zero-rated tax',
          'code','ATOMIC-ZERO-TAX',
          'rate',0,
          'taxable_amount',100,
          'tax_amount',0,
          'is_compound',false,
          'tax_order',0
        ))
      ))
    )
  $,
  'An explicitly selected zero-rated tax is saved as invoice tax evidence'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.invoice_item_taxes s
    JOIN public.invoices i ON i.id=s.invoice_id
    WHERE i.notes='Atomic zero-rated tax'
      AND s.tax_code='ATOMIC-ZERO-TAX'
      AND s.tax_amount=0
  ),
  1,
  'Zero-rated tax selection is preserved in the per-line snapshot'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.invoice_taxes t
    JOIN public.invoices i ON i.id=t.invoice_id
    WHERE i.notes='Atomic zero-rated tax'
      AND t.tax_amount=0
  ),
  1,
  'Zero-rated tax is preserved in the aggregated invoice tax evidence'
);

SELECT extensions.throws_ok(
  $
    SELECT public.create_invoice_draft(
      (SELECT id FROM public.customers WHERE code='ATOMIC-INVOICE-CUSTOMER'),
      CURRENT_DATE, NULL, 'Must roll back', NULL, false,
      100, 0, 0, 101,
      '[{"description":"Atomic line","quantity":2,"unit_price":50,"discount_type":null,"discount_value":0,"tax_rate":0,"tax_amount":0,"line_total":100,"sort_order":0,"tax_breakdown":[]}]'::jsonb
    )
  $$,
  'P0001',
  'Invoice header totals do not reconcile to its line items and tax evidence',
  'Mismatched invoice totals are rejected'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.invoices
    WHERE customer_id=(SELECT id FROM public.customers WHERE code='ATOMIC-INVOICE-CUSTOMER')
      AND notes='Must roll back'
  ),
  0,
  'A failed invoice draft leaves no orphaned invoice row'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id=ii.invoice_id
    WHERE i.customer_id=(SELECT id FROM public.customers WHERE code='ATOMIC-INVOICE-CUSTOMER')
  ),
  1,
  'A failed draft leaves no partial invoice lines'
);

SELECT * FROM extensions.finish();
ROLLBACK;
