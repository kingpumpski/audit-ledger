BEGIN;
SELECT plan(5);

SELECT ok(
  has_function_privilege('authenticated','public.current_business_id()','EXECUTE'),
  'authenticated users can resolve their active business'
);

SELECT ok(
  NOT has_function_privilege('anon','public.current_business_id()','EXECUTE'),
  'anonymous users cannot resolve an active business'
);

SELECT is(
  (SELECT count(*)::integer
   FROM information_schema.columns
   WHERE table_schema='public'
     AND column_name='business_id'
     AND column_default LIKE '%current_business_id%'
     AND table_name = ANY(ARRAY['chart_of_accounts','company_settings','credit_note_line_taxes','credit_note_lines','credit_notes','customer_credit_applications','customer_credit_refunds','customers','discounts','financial_completeness_attestations','inventory_count_adjustments','inventory_purchase_reversals','inventory_transactions','invoice_item_direct_costs','invoice_item_taxes','invoice_items','invoice_taxes','invoices','journal_entries','journal_lines','operating_expense_payments','operating_expense_refunds','operating_expense_reversals','operating_expenses','payment_clearing_settlements','payments','petty_cash_expense_reversals','petty_cash_transactions','product_price_history','products','receipts','sequences','taxes'])),
  33,
  'all business-owned tables default new rows to the active business'
);

SELECT is(
  (SELECT count(*)::integer
   FROM information_schema.columns
   WHERE table_schema='public'
     AND column_name='business_id'
     AND is_nullable='NO'
     AND table_name = ANY(ARRAY['chart_of_accounts','company_settings','credit_note_line_taxes','credit_note_lines','credit_notes','customer_credit_applications','customer_credit_refunds','customers','discounts','financial_completeness_attestations','inventory_count_adjustments','inventory_purchase_reversals','inventory_transactions','invoice_item_direct_costs','invoice_item_taxes','invoice_items','invoice_taxes','invoices','journal_entries','journal_lines','operating_expense_payments','operating_expense_refunds','operating_expense_reversals','operating_expenses','payment_clearing_settlements','payments','petty_cash_expense_reversals','petty_cash_transactions','product_price_history','products','receipts','sequences','taxes'])),
  33,
  'business ownership remains mandatory on every operational table'
);

SELECT ok(
  has_function_privilege('service_role','public.current_business_id()','EXECUTE'),
  'trusted backend automation can resolve the compatibility business default'
);

SELECT * FROM finish();
ROLLBACK;
