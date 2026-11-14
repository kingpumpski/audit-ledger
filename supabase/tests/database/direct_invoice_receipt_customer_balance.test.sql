CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(3);

INSERT INTO auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data
) VALUES (
  'ca200000-0000-4000-8000-000000000001','authenticated','authenticated',
  'direct-receipt-balance@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb
);
INSERT INTO public.user_roles(user_id,role)
VALUES ('ca200000-0000-4000-8000-000000000001','accountant');
SELECT set_config('request.jwt.claim.sub','ca200000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

INSERT INTO public.customers(code,name)
VALUES('DIR-REC-001','Direct invoice receipt balance customer');

INSERT INTO public.invoices(
  invoice_number,customer_id,status,issue_date,subtotal,tax_amount,total_amount,amount_paid,balance_due
)
SELECT 'DIR-REC-INV-001',id,'issued',CURRENT_DATE-10,80,0,80,0,80
FROM public.customers WHERE code='DIR-REC-001';

INSERT INTO public.journal_entries(
  entry_number,entry_date,description,source_type,source_id,currency,created_by
)
SELECT 'DIR-REC-JE-001',CURRENT_DATE-10,'Direct receipt balance invoice','invoice',i.id,'USD',
  'ca200000-0000-4000-8000-000000000001'
FROM public.invoices i WHERE i.invoice_number='DIR-REC-INV-001';

INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
SELECT je.id,1,coa.id,'Accounts receivable',80,0
FROM public.journal_entries je JOIN public.chart_of_accounts coa ON coa.code='1100'
WHERE je.entry_number='DIR-REC-JE-001';
INSERT INTO public.journal_lines(journal_entry_id,line_number,account_id,description,debit,credit)
SELECT je.id,2,coa.id,'Sales revenue',0,80
FROM public.journal_entries je JOIN public.chart_of_accounts coa ON coa.code='4000'
WHERE je.entry_number='DIR-REC-JE-001';

-- Legacy/direct invoice receipt: journalled against AR, but no payments row exists.
INSERT INTO public.receipts(
  receipt_number,invoice_id,customer_id,amount,payment_method,issue_date,
  issued_by,issuer_name,status,is_locked
)
SELECT 'DIR-REC-001',i.id,i.customer_id,25,'cash',(CURRENT_DATE-4)::timestamptz,
  'ca200000-0000-4000-8000-000000000001','Direct receipt test','issued',true
FROM public.invoices i WHERE i.invoice_number='DIR-REC-INV-001';

SELECT extensions.is(
  (SELECT outstanding_balance
   FROM public.get_customer_account_balances(CURRENT_DATE-5)
   WHERE customer_code='DIR-REC-001'),
  80.00::numeric,
  'Historical balance before the direct receipt remains fully outstanding'
);
SELECT extensions.is(
  (SELECT outstanding_balance
   FROM public.get_customer_account_balances(CURRENT_DATE-3)
   WHERE customer_code='DIR-REC-001'),
  55.00::numeric,
  'An issued direct invoice receipt reduces the receivable balance'
);
SELECT extensions.is(
  (SELECT payments_received
   FROM public.get_customer_account_balances(CURRENT_DATE-3)
   WHERE customer_code='DIR-REC-001'),
  25.00::numeric,
  'Direct invoice receipts are included in payments received exactly once'
);

SELECT * FROM extensions.finish();
ROLLBACK;
