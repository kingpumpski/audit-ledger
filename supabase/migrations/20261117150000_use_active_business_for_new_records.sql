-- Resolve the active workspace from a server-authenticated app_metadata
-- claim. If no claim exists yet, preserve legacy single-workspace behavior for
-- existing members. Service-role automation continues to default to the
-- legacy workspace until each trusted job is made explicitly business-aware.

CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $current_business_id$
DECLARE
  v_claimed_business_id uuid;
  v_legacy_business_id uuid;
BEGIN
  IF auth.jwt() ->> 'role' = 'service_role' OR auth.uid() IS NULL THEN
    -- Trusted backend jobs and SQL maintenance/test sessions without an end
    -- user retain the legacy compatibility default. Anonymous callers do not
    -- have EXECUTE permission on this function.
    RETURN public.legacy_business_id();
  END IF;

  v_claimed_business_id :=
    nullif(auth.jwt() -> 'app_metadata' ->> 'active_business_id', '')::uuid;

  IF v_claimed_business_id IS NOT NULL
     AND public.is_business_member(v_claimed_business_id) THEN
    RETURN v_claimed_business_id;
  END IF;

  v_legacy_business_id := public.legacy_business_id();
  IF auth.uid() IS NOT NULL
     AND public.is_business_member(v_legacy_business_id) THEN
    RETURN v_legacy_business_id;
  END IF;

  RETURN NULL;
END;
$current_business_id$;

REVOKE ALL ON FUNCTION public.current_business_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_business_id() TO authenticated, service_role;

DO $business_defaults$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'chart_of_accounts',
    'company_settings',
    'credit_note_line_taxes',
    'credit_note_lines',
    'credit_notes',
    'customer_credit_applications',
    'customer_credit_refunds',
    'customers',
    'discounts',
    'financial_completeness_attestations',
    'inventory_count_adjustments',
    'inventory_purchase_reversals',
    'inventory_transactions',
    'invoice_item_direct_costs',
    'invoice_item_taxes',
    'invoice_items',
    'invoice_taxes',
    'invoices',
    'journal_entries',
    'journal_lines',
    'operating_expense_payments',
    'operating_expense_refunds',
    'operating_expense_reversals',
    'operating_expenses',
    'payment_clearing_settlements',
    'payments',
    'petty_cash_expense_reversals',
    'petty_cash_transactions',
    'product_price_history',
    'products',
    'receipts',
    'sequences',
    'taxes'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ALTER COLUMN business_id SET DEFAULT public.current_business_id()',
      v_table
    );
    EXECUTE pg_catalog.format(
      'COMMENT ON COLUMN public.%I.business_id IS %L',
      v_table,
      'Owning business. New writes use the authenticated active business claim; legacy members without a claim continue to use legacy_workspace.'
    );
  END LOOP;
END;
$business_defaults$;

NOTIFY pgrst, 'reload schema';
