BEGIN;
SELECT plan(4);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_indexes
   WHERE schemaname='public'
     AND indexname = ANY(ARRAY['uq_business_chart_accounts_code','uq_business_customers_code','uq_business_discounts_code','uq_business_invoices_number','uq_business_payments_number','uq_business_products_sku','uq_business_receipts_number','uq_business_taxes_code','uq_business_credit_notes_number','uq_business_expenses_number','uq_business_journal_entries_number','uq_business_attestations_sequence','uq_business_company_settings','uq_business_journal_source','uq_business_clearing_provider_ref'])),
  15,
  'all business-scoped unique indexes are installed'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname='public'
      AND indexname = ANY(ARRAY['uq_business_chart_accounts_code','uq_business_customers_code','uq_business_discounts_code','uq_business_invoices_number','uq_business_payments_number','uq_business_products_sku','uq_business_receipts_number','uq_business_taxes_code','uq_business_credit_notes_number','uq_business_expenses_number','uq_business_journal_entries_number','uq_business_attestations_sequence','uq_business_company_settings','uq_business_journal_source','uq_business_clearing_provider_ref'])
      AND indexdef NOT LIKE '%(business_id%'
  ),
  'every scoped unique key starts with business_id'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public'
      AND indexname='uq_business_company_settings'
      AND indexdef LIKE '%(business_id)%'
  ),
  'each business can have its own company settings row'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public'
      AND indexname='uq_sequences_business_id_name'
  ),
  'sequence names are already unique within a business'
);

SELECT * FROM finish();
ROLLBACK;
