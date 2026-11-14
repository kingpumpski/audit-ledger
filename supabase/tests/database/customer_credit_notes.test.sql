CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(49);

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

SELECT extensions.is(
  has_table_privilege('authenticated','public.credit_notes','SELECT'),
  true,
  'Authenticated finance users receive read-only SELECT privilege on credit notes'
);

SELECT extensions.is(
  has_table_privilege('authenticated','public.credit_notes','INSERT'),
  false,
  'Authenticated users cannot insert credit notes directly'
);

SELECT extensions.is(
  has_table_privilege('anon','public.credit_notes','SELECT'),
  false,
  'Anonymous users cannot read credit notes'
);

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
  $ SELECT public.refund_customer_credit(
    (SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-002'),
    1,CURRENT_DATE,'credit_card','CUSTOMER-REFUND-UNSUPPORTED',
    'c1000000-0000-4000-8000-000000000405'
  ) $,
  'P0001',
  'Customer-credit refunds must use cash, bank transfer or mobile payment',
  'Customer-credit refunds cannot misclassify card or unsupported methods as bank transfers'
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


INSERT INTO public.products(
  sku,name,current_price,cost_price,cost_price_verified,stock_quantity,is_service,is_active
) VALUES('TEST-CN-STOCK-001','Credit note stock return item',30,NULL,false,0,false,true);

SELECT extensions.lives_ok(
  $$ SELECT public.record_stock_purchase(
    (SELECT id FROM public.products WHERE sku='TEST-CN-STOCK-001'),
    5,10,'Credit note supplier','CN-STOCK-PURCHASE-001',50,
    'cash','Purchase fixture for stock-return credit note',NULL,
    'c1000000-0000-4000-8000-000000000701'
  ) $$,
  'A physical product receives verified stock before invoice issue'
);

INSERT INTO public.invoices(
  invoice_number,customer_id,status,issue_date,subtotal,tax_amount,total_amount,amount_paid,balance_due
)
SELECT 'INV-CN-005',id,'draft',CURRENT_DATE,60,0,60,0,60
FROM public.customers WHERE code='CREDIT-NOTE-CUSTOMER';
INSERT INTO public.invoice_items(
  invoice_id,product_id,description,quantity,unit_price,tax_rate,tax_amount,line_total
)
SELECT i.id,p.id,'Physical stock line',2,30,0,0,60
FROM public.invoices i CROSS JOIN public.products p
WHERE i.invoice_number='INV-CN-005' AND p.sku='TEST-CN-STOCK-001';

SELECT extensions.lives_ok(
  $$ SELECT public.issue_invoice((SELECT id FROM public.invoices WHERE invoice_number='INV-CN-005')) $$,
  'Physical-goods invoice can issue using verified stock cost'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku='TEST-CN-STOCK-001'),
  3,
  'Invoice issue relieves the exact physical stock quantity'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_stock_purchase(
    (SELECT id FROM public.products WHERE sku='TEST-CN-STOCK-001'),
    2,20,'Second credit note supplier','CN-STOCK-PURCHASE-002',40,
    'cash','Second purchase at a different verified unit cost',NULL,
    'c1000000-0000-4000-8000-000000000703'
  ) $$,
  'A later purchase updates weighted-average inventory cost before the customer return'
);

SELECT extensions.is(
  (SELECT cost_price FROM public.products WHERE sku='TEST-CN-STOCK-001'),
  14.0000::numeric,
  'Weighted-average cost reflects the later purchase before the return'
);



SELECT extensions.lives_ok(
  $$ SELECT public.record_invoice_credit_note(
    (SELECT id FROM public.invoices WHERE invoice_number='INV-CN-005'),
    jsonb_build_array(jsonb_build_object(
      'invoice_item_id',(SELECT id FROM public.invoice_items WHERE description='Physical stock line'),
      'quantity',1
    )),
    CURRENT_DATE,'One physical unit returned','RETURN-REF-CN-STOCK-001',
    'c1000000-0000-4000-8000-000000000702'
  ) $$,
  'A physical-goods credit note restores stock at the original verified cost'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku='TEST-CN-STOCK-001'),
  6,
  'Physical return restores one unit to stock'
);

SELECT extensions.is(
  (SELECT inventory_cost FROM public.credit_note_lines
   WHERE credit_note_id=(SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-STOCK-001')),
  10.00::numeric,
  'Credit note stores the original verified inventory cost for the returned quantity'
);

SELECT extensions.is(
  (SELECT cost_price FROM public.products WHERE sku='TEST-CN-STOCK-001'),
  13.3333::numeric,
  'Returning goods at original cost recomputes the current weighted-average inventory valuation'
);

SELECT extensions.is(
  (SELECT cost_price_verified FROM public.products WHERE sku='TEST-CN-STOCK-001'),
  true,
  'Audited stock return retains verified status for the recomputed weighted-average cost'
);





SELECT extensions.is(
  (SELECT count(*)::integer FROM public.inventory_transactions
   WHERE reference_type='credit_note'
     AND reference_id=(SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-STOCK-001')
     AND type='return' AND quantity=1),
  1,
  'Stock return creates one immutable inventory return movement'
);

SELECT extensions.is(
  (SELECT previous_quantity FROM public.inventory_transactions
   WHERE reference_type='credit_note'
     AND reference_id=(SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-STOCK-001')
     AND type='return'),
  5,
  'Inventory return audit preserves the stock quantity before the return'
);

SELECT extensions.is(
  (SELECT new_quantity FROM public.inventory_transactions
   WHERE reference_type='credit_note'
     AND reference_id=(SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-STOCK-001')
     AND type='return'),
  6,
  'Inventory return audit preserves the stock quantity after the return'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit),2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='credit_note'
     AND je.source_id=(SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-STOCK-001')
     AND coa.code='1200'),
  10.00::numeric,
  'Returned inventory is debited at the original verified cost'
);

SELECT extensions.is(
  (SELECT round(sum(jl.credit),2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='credit_note'
     AND je.source_id=(SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-STOCK-001')
     AND coa.code='5000'),
  10.00::numeric,
  'Cost of goods sold is reversed at the original verified cost'
);

INSERT INTO public.taxes(
  code,name,type,rate,is_compound,is_active,liability_account_id,effective_from
)
SELECT 'CN-TAX-001','Credit note VAT','vat',15,false,true,coa.id,CURRENT_DATE
FROM public.chart_of_accounts coa WHERE coa.code='2100';

INSERT INTO public.invoices(
  invoice_number,customer_id,status,issue_date,subtotal,tax_amount,total_amount,amount_paid,balance_due
)
SELECT 'INV-CN-006',id,'draft',CURRENT_DATE,100,15,115,0,115
FROM public.customers WHERE code='CREDIT-NOTE-CUSTOMER';
INSERT INTO public.invoice_items(
  invoice_id,description,quantity,unit_price,tax_rate,tax_amount,line_total
)
SELECT id,'Taxed credit note line',1,100,15,15,115
FROM public.invoices WHERE invoice_number='INV-CN-006';

INSERT INTO public.invoice_taxes(
  invoice_id,tax_id,tax_rate,taxable_amount,tax_amount,liability_account_id
)
SELECT i.id,t.id,t.rate,100,15,t.liability_account_id
FROM public.invoices i JOIN public.taxes t ON t.code='CN-TAX-001'
WHERE i.invoice_number='INV-CN-006';

INSERT INTO public.invoice_item_taxes(
  invoice_id,invoice_item_id,tax_id,tax_name,tax_code,tax_rate,is_compound,
  tax_order,taxable_amount,tax_amount,liability_account_id
)
SELECT i.id,ii.id,t.id,t.name,t.code,t.rate,t.is_compound,0,100,15,t.liability_account_id
FROM public.invoices i
JOIN public.invoice_items ii ON ii.invoice_id=i.id
JOIN public.taxes t ON t.code='CN-TAX-001'
WHERE i.invoice_number='INV-CN-006';

SELECT extensions.lives_ok(
  $$ SELECT public.issue_invoice((SELECT id FROM public.invoices WHERE invoice_number='INV-CN-006')) $$,
  'Invoice with exact line-level tax snapshots can be issued'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_invoice_credit_note(
    (SELECT id FROM public.invoices WHERE invoice_number='INV-CN-006'),
    jsonb_build_array(jsonb_build_object(
      'invoice_item_id',(SELECT id FROM public.invoice_items WHERE description='Taxed credit note line'),
      'quantity',0.5
    )),
    CURRENT_DATE,'Half of taxed line returned','RETURN-REF-CN-TAX-001',
    'c1000000-0000-4000-8000-000000000801'
  ) $$,
  'Partial taxed credit note uses the original per-line tax snapshot'
);

SELECT extensions.is(
  (SELECT tax_amount FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-TAX-001'),
  7.50::numeric,
  'Partial credit reverses exactly half of the original line tax'
);

SELECT extensions.is(
  (SELECT tax_amount FROM public.credit_note_line_taxes
   WHERE credit_note_line_id=(SELECT id FROM public.credit_note_lines
     WHERE credit_note_id=(SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-TAX-001'))),
  7.50::numeric,
  'Credit-note tax evidence preserves the source tax identity and exact tax amount'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit),2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   JOIN public.chart_of_accounts coa ON coa.id=jl.account_id
   WHERE je.source_type='credit_note'
     AND je.source_id=(SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-TAX-001')
     AND coa.code='2100'),
  7.50::numeric,
  'Credit note debits the original tax liability account for the exact tax reversal'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit-jl.credit),2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   WHERE je.source_type='credit_note'
     AND je.source_id=(SELECT id FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-TAX-001')),
  0.00::numeric,
  'Taxed credit-note journal remains balanced'
);

SELECT extensions.is(
  (SELECT credit_amount FROM public.get_customer_credit_balances(
    (SELECT id FROM public.customers WHERE code='CREDIT-NOTE-CUSTOMER')
  ) WHERE credit_note_number='CN-' || upper(substr(replace(
    (SELECT id::text FROM public.credit_notes WHERE reference_number='RETURN-REF-CN-002'),'-',''
  ),1,12))),
  50.00::numeric,
  'Customer credit summary reports the original overpaid credit amount'
);

SELECT extensions.is(
  (SELECT applied_amount FROM public.get_customer_credit_balances(
    (SELECT id FROM public.customers WHERE code='CREDIT-NOTE-CUSTOMER')
  ) WHERE original_invoice_number='INV-CN-002'),
  30.00::numeric,
  'Customer credit summary reports the amount applied to another invoice'
);

SELECT extensions.is(
  (SELECT refunded_amount FROM public.get_customer_credit_balances(
    (SELECT id FROM public.customers WHERE code='CREDIT-NOTE-CUSTOMER')
  ) WHERE original_invoice_number='INV-CN-002'),
  20.00::numeric,
  'Customer credit summary reports the amount actually refunded'
);

SELECT extensions.is(
  (SELECT remaining_amount FROM public.get_customer_credit_balances(
    (SELECT id FROM public.customers WHERE code='CREDIT-NOTE-CUSTOMER')
  ) WHERE original_invoice_number='INV-CN-002'),
  0.00::numeric,
  'Customer credit summary shows no amount remaining after full application and refund'
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
