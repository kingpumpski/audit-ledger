CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(5);

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

SELECT extensions.throws_ok(
  $$
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
