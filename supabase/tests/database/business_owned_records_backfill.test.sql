BEGIN;
SELECT plan(9);

SELECT is(
  (SELECT count(*)::integer
   FROM information_schema.columns
   WHERE table_schema='public'
     AND column_name='business_id'
     AND table_name = ANY(ARRAY['chart_of_accounts','company_settings','credit_note_line_taxes','credit_note_lines','credit_notes','customer_credit_applications','customer_credit_refunds','customers','discounts','financial_completeness_attestations','inventory_count_adjustments','inventory_purchase_reversals','inventory_transactions','invoice_item_direct_costs','invoice_item_taxes','invoice_items','invoice_taxes','invoices','journal_entries','journal_lines','operating_expense_payments','operating_expense_refunds','operating_expense_reversals','operating_expenses','payment_clearing_settlements','payments','petty_cash_expense_reversals','petty_cash_transactions','product_price_history','products','receipts','sequences','taxes'])),
  33,
  'all business-owned tables have an ownership column'
);

SELECT is(
  (SELECT count(*)::integer
   FROM information_schema.columns
   WHERE table_schema='public'
     AND column_name='business_id'
     AND is_nullable='NO'
     AND table_name = ANY(ARRAY['chart_of_accounts','company_settings','credit_note_line_taxes','credit_note_lines','credit_notes','customer_credit_applications','customer_credit_refunds','customers','discounts','financial_completeness_attestations','inventory_count_adjustments','inventory_purchase_reversals','inventory_transactions','invoice_item_direct_costs','invoice_item_taxes','invoice_items','invoice_taxes','invoices','journal_entries','journal_lines','operating_expense_payments','operating_expense_refunds','operating_expense_reversals','operating_expenses','payment_clearing_settlements','payments','petty_cash_expense_reversals','petty_cash_transactions','product_price_history','products','receipts','sequences','taxes'])),
  33,
  'business ownership columns are non-null'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_constraint c
   JOIN pg_class r ON r.oid=c.conrelid
   JOIN pg_namespace n ON n.oid=r.relnamespace
   WHERE n.nspname='public'
     AND c.contype='f'
     AND c.conname = ANY(ARRAY['chart_of_accounts_business_id_fkey','company_settings_business_id_fkey','credit_note_line_taxes_business_id_fkey','credit_note_lines_business_id_fkey','credit_notes_business_id_fkey','customer_credit_applications_business_id_fkey','customer_credit_refunds_business_id_fkey','customers_business_id_fkey','discounts_business_id_fkey','financial_completeness_attestations_business_id_fkey','inventory_count_adjustments_business_id_fkey','inventory_purchase_reversals_business_id_fkey','inventory_transactions_business_id_fkey','invoice_item_direct_costs_business_id_fkey','invoice_item_taxes_business_id_fkey','invoice_items_business_id_fkey','invoice_taxes_business_id_fkey','invoices_business_id_fkey','journal_entries_business_id_fkey','journal_lines_business_id_fkey','operating_expense_payments_business_id_fkey','operating_expense_refunds_business_id_fkey','operating_expense_reversals_business_id_fkey','operating_expenses_business_id_fkey','payment_clearing_settlements_business_id_fkey','payments_business_id_fkey','petty_cash_expense_reversals_business_id_fkey','petty_cash_transactions_business_id_fkey','product_price_history_business_id_fkey','products_business_id_fkey','receipts_business_id_fkey','sequences_business_id_fkey','taxes_business_id_fkey'])),
  33,
  'every business-owned table references businesses'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_indexes
   WHERE schemaname='public'
     AND indexname = ANY(ARRAY['uq_chart_of_accounts_business_id_id','uq_company_settings_business_id_id','uq_credit_note_line_taxes_business_id_id','uq_credit_note_lines_business_id_id','uq_credit_notes_business_id_id','uq_customer_credit_applications_business_id_id','uq_customer_credit_refunds_business_id_id','uq_customers_business_id_id','uq_discounts_business_id_id','uq_financial_completeness_attestations_business_id_id','uq_inventory_count_adjustments_business_id_id','uq_inventory_purchase_reversals_business_id_id','uq_inventory_transactions_business_id_id','uq_invoice_item_direct_costs_business_id_id','uq_invoice_item_taxes_business_id_id','uq_invoice_items_business_id_id','uq_invoice_taxes_business_id_id','uq_invoices_business_id_id','uq_journal_entries_business_id_id','uq_journal_lines_business_id_id','uq_operating_expense_payments_business_id_id','uq_operating_expense_refunds_business_id_id','uq_operating_expense_reversals_business_id_id','uq_operating_expenses_business_id_id','uq_payment_clearing_settlements_business_id_id','uq_payments_business_id_id','uq_petty_cash_expense_reversals_business_id_id','uq_petty_cash_transactions_business_id_id','uq_product_price_history_business_id_id','uq_products_business_id_id','uq_receipts_business_id_id','uq_sequences_business_id_name','uq_taxes_business_id_id'])),
  33,
  'every business-owned table has a tenant-aware unique key'
);

SELECT is(
  (SELECT count(*)::integer
   FROM information_schema.columns
   WHERE table_schema='public'
     AND column_name='business_id'
     AND column_default LIKE '%legacy_business_id%'),
  33,
  'legacy workspace default preserves current application inserts'
);

SELECT ok(
  has_function_privilege('authenticated','public.legacy_business_id()','EXECUTE'),
  'authenticated legacy writes can resolve the default business'
);

SELECT ok(
  NOT has_function_privilege('anon','public.legacy_business_id()','EXECUTE'),
  'anonymous callers cannot resolve the legacy business default'
);

SELECT ok(
  (SELECT is_nullable='YES' FROM information_schema.columns
   WHERE table_schema='public' AND table_name='audit_logs' AND column_name='business_id'),
  'audit logs retain nullable business context for platform events'
);

SELECT ok(
  (SELECT is_nullable='YES' FROM information_schema.columns
   WHERE table_schema='public' AND table_name='notifications' AND column_name='business_id'),
  'notifications retain nullable business context for user-scoped events'
);

SELECT * FROM finish();
ROLLBACK;
