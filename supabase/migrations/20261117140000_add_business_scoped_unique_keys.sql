-- Add business-scoped unique keys before the tenant RLS cutover.
-- The old global unique indexes intentionally remain for now: the current
-- frontend still operates only in legacy_workspace. A later cutover migration
-- will remove the global variants only after every RPC and client query carries
-- an authorized business context.

CREATE UNIQUE INDEX uq_business_chart_accounts_code
  ON public.chart_of_accounts (business_id, code);

CREATE UNIQUE INDEX uq_business_customers_code
  ON public.customers (business_id, code);

CREATE UNIQUE INDEX uq_business_discounts_code
  ON public.discounts (business_id, code);

CREATE UNIQUE INDEX uq_business_invoices_number
  ON public.invoices (business_id, invoice_number);

CREATE UNIQUE INDEX uq_business_payments_number
  ON public.payments (business_id, payment_number);

CREATE UNIQUE INDEX uq_business_products_sku
  ON public.products (business_id, sku);

CREATE UNIQUE INDEX uq_business_receipts_number
  ON public.receipts (business_id, receipt_number);

CREATE UNIQUE INDEX uq_business_taxes_code
  ON public.taxes (business_id, code);

CREATE UNIQUE INDEX uq_business_credit_notes_number
  ON public.credit_notes (business_id, credit_note_number);

CREATE UNIQUE INDEX uq_business_expenses_number
  ON public.operating_expenses (business_id, expense_number);

CREATE UNIQUE INDEX uq_business_journal_entries_number
  ON public.journal_entries (business_id, entry_number);

CREATE UNIQUE INDEX uq_business_attestations_sequence
  ON public.financial_completeness_attestations (business_id, attestation_sequence);

CREATE UNIQUE INDEX uq_business_company_settings
  ON public.company_settings (business_id);

CREATE UNIQUE INDEX uq_business_journal_source
  ON public.journal_entries (business_id, source_type, source_id);

CREATE UNIQUE INDEX uq_business_clearing_provider_ref
  ON public.payment_clearing_settlements (business_id, clearing_account_id, provider_reference);

-- Sequences already have uq_sequences_business_id_name from phase 1. The
-- global sequences_pkey is retained until get_next_sequence is made business-aware.

NOTIFY pgrst, 'reload schema';
