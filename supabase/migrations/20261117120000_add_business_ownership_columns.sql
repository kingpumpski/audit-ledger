-- Phase 1 of operational tenancy: add ownership keys to every
-- business-owned record and deterministically assign all pre-tenancy data to
-- the single legacy workspace. This migration deliberately does NOT replace
-- existing RLS policies or claim cross-business isolation. That cutover waits
-- for tenant-aware composite FKs, scoped unique constraints, RPCs and frontend
-- business context.

CREATE OR REPLACE FUNCTION public.legacy_business_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $legacy_business_id$
DECLARE
  v_business_id uuid;
  v_count integer;
BEGIN
  SELECT count(*)::integer
    INTO v_count
  FROM public.businesses
  WHERE business_type = 'legacy_workspace'
    AND status = 'active';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Exactly one active legacy workspace is required while legacy writes remain enabled'
      USING ERRCODE = '55000';
  END IF;

  SELECT id
    INTO v_business_id
  FROM public.businesses
  WHERE business_type = 'legacy_workspace'
    AND status = 'active'
  ORDER BY created_at, id
  LIMIT 1;

  RETURN v_business_id;
END;
$legacy_business_id$;

REVOKE ALL ON FUNCTION public.legacy_business_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legacy_business_id() TO authenticated, service_role;

DO $ownership_columns$
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
      'ALTER TABLE public.%I ADD COLUMN business_id uuid',
      v_table
    );

    -- Every existing operational row belongs to the pre-existing workspace.
    -- The default keeps the current single-workspace application write-safe
    -- until tenant-aware application/RPC changes are deployed.
    EXECUTE pg_catalog.format(
      'UPDATE public.%I SET business_id = public.legacy_business_id() WHERE business_id IS NULL',
      v_table
    );

    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ALTER COLUMN business_id SET DEFAULT public.legacy_business_id()',
      v_table
    );
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ALTER COLUMN business_id SET NOT NULL',
      v_table
    );
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT',
      v_table,
      v_table || '_business_id_fkey'
    );

    -- Composite uniqueness supports tenant-consistent foreign keys in phase 2
    -- and doubles as the leading business_id index for tenant-filtered reads.
    EXECUTE pg_catalog.format(
      'CREATE UNIQUE INDEX %I ON public.%I (business_id, id)',
      'uq_' || v_table || '_business_id_id',
      v_table
    );

    EXECUTE pg_catalog.format(
      'COMMENT ON COLUMN public.%I.business_id IS %L',
      v_table,
      'Owning business. Legacy writes default to the legacy workspace until tenant-aware RPC and frontend context are released.'
    );
  END LOOP;
END;
$ownership_columns$;

-- User and platform records may be associated with a business event, but are
-- not themselves owned by a business. NULL preserves platform/security events.
ALTER TABLE public.audit_logs
  ADD COLUMN business_id uuid REFERENCES public.businesses(id) ON DELETE RESTRICT;
CREATE INDEX idx_audit_logs_business_id
  ON public.audit_logs (business_id);

ALTER TABLE public.notifications
  ADD COLUMN business_id uuid REFERENCES public.businesses(id) ON DELETE RESTRICT;
CREATE INDEX idx_notifications_business_id
  ON public.notifications (business_id);

NOTIFY pgrst, 'reload schema';
