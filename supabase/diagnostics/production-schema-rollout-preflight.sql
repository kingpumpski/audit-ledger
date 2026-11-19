-- READ-ONLY production schema rollout preflight for Audit Ledger.
-- Run in the Supabase SQL Editor before planning any production migration.
-- This file intentionally performs no DDL, DML, migration-history edits, or cache reloads.

-- 1) Confirm the connected database and inspect recent migration history.
SELECT
  current_database() AS database_name,
  current_user AS executing_role,
  now() AS inspected_at;

SELECT version
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 40;

-- 2) Check the operational objects required by the current Store,
-- workspace-security, notification and supplier-directory implementation.
WITH expected_objects(object_name, purpose) AS (
  VALUES
    ('public.store_locations', 'Physical and virtual stock locations'),
    ('public.stock_balances', 'Location-level on-hand/reserved/quarantined projection'),
    ('public.product_location_settings', 'Per-location replenishment settings'),
    ('public.stock_transfers', 'Inter-location transfer headers'),
    ('public.stock_transfer_lines', 'Inter-location transfer lines'),
    ('public.stock_transfer_receipts', 'Partial transfer receipt headers'),
    ('public.stock_transfer_receipt_lines', 'Partial transfer receipt lines'),
    ('public.business_invitations', 'Business membership invitations'),
    ('public.notifications', 'Project-wide activity notifications'),
    ('public.suppliers', 'Business-scoped supplier master records'),
    ('public.supplier_products', 'Supplier purchasing terms by product'),
    ('public.store_stock_counts', 'Blind cycle count headers'),
    ('public.store_stock_count_lines', 'Blind cycle count SKU snapshots')
)
SELECT
  object_name,
  purpose,
  to_regclass(object_name) IS NOT NULL AS exists
FROM expected_objects
ORDER BY object_name;

-- 3) Check the restricted RPC owner role and core business authorization helpers.
SELECT
  'audit_ledger_rpc_owner' AS object_name,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'audit_ledger_rpc_owner'
  ) AS exists
UNION ALL
SELECT
  'public.is_business_member(uuid)',
  to_regprocedure('public.is_business_member(uuid)') IS NOT NULL
UNION ALL
SELECT
  'public.has_business_role(uuid,text[])',
  to_regprocedure('public.has_business_role(uuid,text[])') IS NOT NULL
ORDER BY object_name;

-- 3a) Verify the constrained RPC role attributes when it exists.
SELECT
  rolname,
  rolcanlogin,
  rolsuper,
  rolbypassrls
FROM pg_catalog.pg_roles
WHERE rolname = 'audit_ledger_rpc_owner';

-- 3b) Summarize SECURITY DEFINER ownership and row-security settings.
SELECT
  pg_catalog.count(*) AS public_security_definer_count,
  pg_catalog.count(*) FILTER (
    WHERE pg_catalog.pg_get_userbyid(p.proowner) = 'audit_ledger_rpc_owner'
  ) AS owned_by_constrained_rpc_role,
  pg_catalog.count(*) FILTER (
    WHERE NOT COALESCE(p.proconfig @> ARRAY['row_security=on'], false)
  ) AS without_row_security_on,
  pg_catalog.count(*) FILTER (
    WHERE NOT COALESCE(p.proconfig @> ARRAY['search_path=""'], false)
      AND NOT COALESCE(p.proconfig @> ARRAY['search_path=pg_catalog'], false)
  ) AS without_empty_or_catalog_search_path
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef;

-- 4) Show RLS status for operational tables that exist.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname IN (
    'store_locations',
    'stock_balances',
    'product_location_settings',
    'stock_transfers',
    'stock_transfer_lines',
    'stock_transfer_receipts',
    'stock_transfer_receipt_lines',
    'business_invitations',
    'notifications',
    'suppliers',
    'supplier_products',
    'store_stock_counts',
    'store_stock_count_lines'
  )
ORDER BY c.relname;

-- 5) List policies on the same operational tables for manual authorization review.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'store_locations',
    'stock_balances',
    'product_location_settings',
    'stock_transfers',
    'stock_transfer_lines',
    'stock_transfer_receipts',
    'stock_transfer_receipt_lines',
    'business_invitations',
    'notifications',
    'suppliers',
    'supplier_products',
    'store_stock_counts',
    'store_stock_count_lines'
  )
ORDER BY tablename, policyname;

-- Interpretation:
-- * Missing tables/role/functions are schema gaps, not PostgREST cache problems.
-- * A migration version in production that differs from the repository filename
--   must be mapped by inspecting its actual schema effects before applying anything.
-- * An existing table is not proof that its policies, constraints, triggers or grants
--   match the current repository migration.
-- * Do not run supabase db push, apply migrations, issue DDL/DML, or reload the
--   PostgREST schema cache as a substitute for reconciling migration history.
