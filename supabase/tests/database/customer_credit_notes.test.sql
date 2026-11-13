CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(20);

INSERT INTO auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data
) VALUES
  ('c1000000-0000-4000-8000-000000000001','authenticated','authenticated',
   'credit-note-accountant@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb),
  ('c1000000-0000-4000-8000-000000000002','authenticated','authenticated',
   'credit-note-cashier@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb);

INSERT INTO public.user_roles(user_id,role) VALUES
  ('c1000000-0000-4000-8000-000000000001','accountant'),
  ('c1000000-0000-4000-8000-000000000002','cashier');

INSERT INTO public.customers(code,name)
VALUES('CREDIT-NOTE-CUSTOMER','Credit note test customer');

SELECT set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

INSERT INTO public.invoices (
  invoice_number,customer_id,status,issue_date,subtotal,tax_amount,total_amount,amount_paid,balance_due
)
SELECT 'INV-CN-001',id,'draft',CURRENT_DATE,100,0,100,0,100
FROM public.customers WHERE code='CREDIT-NOTE-CUSTOMER';
INSERT INTO public.invoice_items(invoice_id,description,quantity,unit_price,tax_rate,tax_amount,line_total)
SELECT id,'Credit note manual line',1,100,0,0,100
FROM public.invoices WHERE invoice_number='INV-CN-001';

SELECT extensions.lives_ok(
  $$ SELECT public.issue_invoice((SELECT id FROM public.invoices WHERE invoice_number='INV-CN-001')) $$,
  'Original invoice can be issued before a credit note is recorded'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_invoice_credit_note(
    (SELECT id FROM public.invoices WHERE invoice_number='INV-CN-001'),
    jsonb_build_array(jsonb_build_object(
      'invoice_item_id',(SELECT id FROM public.invoice_items WHERE description='Credit note manual line'),
      'quantity',0.5
    )),
    CURRENT_DATE,'Customer returned half the order','RETURN-REF-CN-001',
    'c1000000-0000-4000-8000-000000000101'
  ) $$,
  'Accountant can issue a partial credit note against an issued invoice'
);

SELECT extensions.is(
  (SELECT total_amount FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-001'),
  50.00::numeric,
  'Partial credit note value is calculated from the original invoice line'
);

SELECT extensions.is(
  (SELECT balance_due FROM public.invoices WHERE invoice_number='INV-CN-001'),
  50.00::numeric,
  'Credit note reduces the original invoice receivable balance'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit-jl.credit),2)
   FROM public.journal_lines jl JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   WHERE je.source_type='credit_note'
     AND je.source_id=(SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-001')),
  0.00::numeric,
  'Credit note posts a balanced double-entry journal'
);

SELECT extensions.is(
  public.record_invoice_credit_note(
    (SELECT id FROM public.invoices WHERE invoice_number='INV-CN-001'),
    jsonb_build_array(jsonb_build_object(
      'invoice_item_id',(SELECT id FROM public.invoice_items WHERE description='Credit note manual line'),
      'quantity',0.5
    )),
    CURRENT_DATE,'Customer returned half the order','RETURN-REF-CN-001',
    'c1000000-0000-4000-8000-000000000101'
  ),
  (SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-001'),
  'Identical credit-note retry returns the original credit note'
);

SELECT extensions.throws_ok(
  $$ SELECT public.record_invoice_credit_note(
    (SELECT id FROM public.invoices WHERE invoice_number='INV-CN-001'),
    jsonb_build_array(jsonb_build_object(
      'invoice_item_id',(SELECT id FROM public.invoice_items WHERE description='Credit note manual line'),
      'quantity',0.6
    )),
    CURRENT_DATE,'Attempt to over-credit','RETURN-REF-CN-OVER',
    'c1000000-0000-4000-8000-000000000102'
  ) $$,
  'P0001',
  'Credit quantity exceeds the uncredited quantity remaining for invoice line ' ||
    (SELECT id::text FROM public.invoice_items WHERE description='Credit note manual line'),
  'A line cannot be credited beyond its original quantity'
);

INSERT INTO public.invoices (
  invoice_number,customer_id,status,issue_date,subtotal,tax_amount,total_amount,amount_paid,balance_due
)
SELECT 'INV-CN-002',id,'draft',CURRENT_DATE,100,0,100,0,100
FROM public.customers WHERE code='CREDIT-NOTE-CUSTOMER';
INSERT INTO public.invoice_items(invoice_id,description,quantity,unit_price,tax_rate,tax_amount,line_total)
SELECT id,'Paid invoice line',1,100,0,0,100
FROM public.invoices WHERE invoice_number='INV-CN-002';

SELECT extensions.lives_ok(
  $$ SELECT public.issue_invoice((SELECT id FROM public.invoices WHERE invoice_number='INV-CN-002')) $$,
  'Second invoice can be issued'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_invoice_payment(
    (SELECT id FROM public.invoices WHERE invoice_number='INV-CN-002'),
    (SELECT id FROM public.customers WHERE code='CREDIT-NOTE-CUSTOMER'),
    100,'cash','c1000000-0000-4000-8000-000000000201',
    'PAY-CN-002','Full settlement before customer return'
  ) $$,
  'A full payment can settle the second invoice before a return'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_invoice_credit_note(
    (SELECT id FROM public.invoices WHERE invoice_number='INV-CN-002'),
    jsonb_build_array(jsonb_build_object(
      'invoice_item_id',(SELECT id FROM public.invoice_items WHERE description='Paid invoice line'),
      'quantity',0.5
    )),
    CURRENT_DATE,'Customer returned half of paid order','RETURN-REF-CN-002',
    'c1000000-0000-4000-8000-000000000103'
  ) $$,
  'Credit note on a paid invoice creates customer credit instead of a negative receivable'
);

SELECT extensions.is(
  (SELECT customer_credit_amount FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-002'),
  50.00::numeric,
  'Overpaid credit is recognized as a customer-credit liability'
);

INSERT INTO public.invoices (
  invoice_number,customer_id,status,issue_date,subtotal,tax_amount,total_amount,amount_paid,balance_due
)
SELECT 'INV-CN-003',id,'draft',CURRENT_DATE,80,0,80,0,80
FROM public.customers WHERE code='CREDIT-NOTE-CUSTOMER';
INSERT INTO public.invoice_items(invoice_id,description,quantity,unit_price,tax_rate,tax_amount,line_total)
SELECT id,'Target invoice line',1,80,0,0,80
FROM public.invoices WHERE invoice_number='INV-CN-003';

SELECT extensions.lives_ok(
  $$ SELECT public.issue_invoice((SELECT id FROM public.invoices WHERE invoice_number='INV-CN-003')) $$,
  'Target invoice can be issued for customer-credit application'
);

SELECT extensions.lives_ok(
  $$ SELECT public.apply_customer_credit(
    (SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-002'),
    (SELECT id FROM public.invoices WHERE invoice_number='INV-CN-003'),
    30,CURRENT_DATE,'CUSTOMER-CREDIT-APPLY-001',
    'c1000000-0000-4000-8000-000000000301'
  ) $$,
  'Customer credit can be applied to another outstanding invoice for the same customer'
);

SELECT extensions.is(
  (SELECT balance_due FROM public.invoices WHERE invoice_number='INV-CN-003'),
  50.00::numeric,
  'Applying customer credit reduces the target invoice balance'
);

SELECT extensions.lives_ok(
  $$ SELECT public.refund_customer_credit(
    (SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-002'),
    20,CURRENT_DATE,'bank_transfer','CUSTOMER-REFUND-001',
    'c1000000-0000-4000-8000-000000000401'
  ) $$,
  'Remaining customer credit can be refunded through an evidenced settlement'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit-jl.credit),2)
   FROM public.journal_lines jl JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   WHERE je.source_type='customer_credit_refund'
     AND je.source_id=(SELECT id FROM public.customer_credit_refunds WHERE reference_number='CUSTOMER-REFUND-001')),
  0.00::numeric,
  'Customer credit refund posts a balanced cash/bank journal'
);

SELECT extensions.throws_ok(
  $$ SELECT public.refund_customer_credit(
    (SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-002'),
    0.01,CURRENT_DATE,'cash','CUSTOMER-REFUND-OVER-001',
    'c1000000-0000-4000-8000-000000000402'
  ) $$,
  'P0001',
  'Refund exceeds the remaining customer credit',
  'Customer credit cannot be refunded or allocated more than once'
);

INSERT INTO public.invoices (
  invoice_number,customer_id,status,issue_date,subtotal,tax_amount,total_amount,amount_paid,balance_due
)
SELECT 'INV-CN-004',id,'draft',CURRENT_DATE,100,10,110,0,110
FROM public.customers WHERE code='CREDIT-NOTE-CUSTOMER';
INSERT INTO public.invoice_items(invoice_id,description,quantity,unit_price,tax_rate,tax_amount,line_total)
SELECT id,'Historical taxed line without allocation',1,100,10,10,110
FROM public.invoices WHERE invoice_number='INV-CN-004';

SELECT extensions.lives_ok(
  $$ SELECT public.issue_invoice((SELECT id FROM public.invoices WHERE invoice_number='INV-CN-004')) $$,
  'Legacy invoice without per-line tax snapshots can still be issued'
);

SELECT extensions.throws_ok(
  $$ SELECT public.record_invoice_credit_note(
    (SELECT id FROM public.invoices WHERE invoice_number='INV-CN-004'),
    jsonb_build_array(jsonb_build_object(
      'invoice_item_id',(SELECT id FROM public.invoice_items WHERE description='Historical taxed line without allocation'),
      'quantity',0.5
    )),
    CURRENT_DATE,'Attempt credit without line tax evidence','RETURN-REF-CN-004',
    'c1000000-0000-4000-8000-000000000501'
  ) $$,
  'P0001',
  'This invoice line lacks reconciled per-line tax evidence; reconstruct the tax allocation before issuing a credit note',
  'Historical taxed invoices without per-line tax evidence are blocked from credit notes'
);

SELECT set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
SELECT extensions.throws_ok(
  $$ SELECT public.record_invoice_credit_note(
    (SELECT id FROM public.invoices WHERE invoice_number='INV-CN-001'),
    jsonb_build_array(jsonb_build_object(
      'invoice_item_id',(SELECT id FROM public.invoice_items WHERE description='Credit note manual line'),
      'quantity',0.1
    )),
    CURRENT_DATE,'Cashier attempt','RETURN-REF-CN-CASHIER',
    'c1000000-0000-4000-8000-000000000601'
  ) $$,
  'P0001',
  'Only an admin or accountant can issue customer credit notes',
  'Cashier cannot issue customer credit notes'
);

SELECT * FROM extensions.finish();
ROLLBACK;
