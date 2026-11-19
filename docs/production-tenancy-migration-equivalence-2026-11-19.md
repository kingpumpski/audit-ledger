# Production tenancy migration semantic comparison — 2026-11-19

## Scope

Read-only comparison of repository migrations:
- `20261117120000_add_business_ownership_columns.sql`
- `20261117130000_add_tenant_consistent_foreign_keys.sql`
- `20261117140000_add_business_scoped_unique_keys.sql`
- `20261117150000_use_active_business_for_new_records.sql`

against the production catalog in project `phfpbqlhxagonpofzvtn`. No production changes were made.

## Ownership columns — schema effects confirmed

The ownership migration defines 33 operational tables with `business_id`, including sequences. Production catalog inspection confirmed all 33 tables have:

- a `business_id` column;
- `NOT NULL`;
- default `current_business_id()`;
- a foreign key to `public.businesses(id)`;
- a matching unique index on `(business_id,id)`, or `(business_id,name)` for sequences.

The migration also adds business ownership references to `audit_logs` and `notifications`; production has corresponding foreign keys from both tables to `businesses(id)`.

This is strong semantic evidence that the production schema contains the intended ownership-column migration effects.

## Tenant-consistent foreign keys — schema effects confirmed

The repository migration defines 56 tenant-consistent composite foreign keys and 56 supporting child-side indexes.

Production catalog inspection returned:
- 56 constraints named `tenant_fk_*`;
- all 56 are validated;
- 56 indexes named `tenant_ix_*`.

This matches the repository migration's generated relationship and index counts.

## Business-scoped unique keys — schema effects confirmed

The repository migration defines 15 business-scoped unique indexes. Production contains all 15 expected names:

- `uq_business_chart_accounts_code`
- `uq_business_customers_code`
- `uq_business_discounts_code`
- `uq_business_invoices_number`
- `uq_business_payments_number`
- `uq_business_products_sku`
- `uq_business_receipts_number`
- `uq_business_taxes_code`
- `uq_business_credit_notes_number`
- `uq_business_expenses_number`
- `uq_business_journal_entries_number`
- `uq_business_attestations_sequence`
- `uq_business_company_settings`
- `uq_business_journal_source`
- `uq_business_clearing_provider_ref`

## Active-business function

Production's `current_business_id()` has the legacy behavior represented by repository migration `20261117150000_use_active_business_for_new_records.sql`: it accepts a valid active-business claim but retains a fallback to the legacy business for role-managed users. The production migration listing names version `20261117120018` as `use_active_business_for_new_records`.

The follow-on tenant/RPC migration `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql` has not been applied according to the production migration history and catalog. The dedicated role `audit_ledger_rpc_owner` is absent, all 47 public tables currently have no restrictive RLS policy, and all 85 public SECURITY DEFINER functions remain owned by `postgres`.

## Result and limits

The schema evidence strongly confirms the effects of the four tenancy/ownership migrations through `use_active_business_for_new_records`. This substantially narrows the production migration gap: the remaining repository migrations after that point are the seven identified in the migration-history comparison.

This is not a cryptographic proof of original migration SQL identity. Catalog state may have been produced by equivalent manual changes or later migrations. Before release, retain the migration-name mapping, inspect relevant function definitions/ACLs and compare exact constraints/index definitions, not just object names.

**No production DDL/DML, migration-history mutation, grants, function changes or schema-cache reload was performed.**
