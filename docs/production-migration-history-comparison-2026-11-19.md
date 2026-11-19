# Production migration-history comparison — 2026-11-19

## Scope and method

Read-only comparison of:
- Production Supabase project ref: `phfpbqlhxagonpofzvtn`.
- Repository `main` migration directory inspected on 2026-11-19.
- Production migration history returned by Supabase's migration listing and queried `supabase_migrations.schema_migrations`.

No production DDL, DML, migration-history edit, schema-cache reload, or migration execution was performed.

## Confirmed production migration history

Production contains 70 migration-history rows. Its latest recorded version is `20261117120018`.

The critical detail is that production migration versions were renumbered, but Supabase's migration listing retains descriptive migration names. The eight production versions after `20261117105432` map by name to repository migration files as follows:

| Production version | Production migration name | Repository migration file |
|---|---|---|
| `20261117112228` | `business_tenancy_foundation` | `20261114170000_business_tenancy_foundation.sql` |
| `20261117112246` | `business_member_administration` | `20261116150000_business_member_administration.sql` |
| `20261117112249` | `index_business_membership_foreign_keys` | `20261116151000_index_business_membership_foreign_keys.sql` |
| `20261117112251` | `index_business_members_user_id` | `20261116152000_index_business_members_user_id.sql` |
| `20261117113408` | `add_business_ownership_columns` | `20261117120000_add_business_ownership_columns.sql` |
| `20261117114039` | `add_tenant_consistent_foreign_keys` | `20261117130000_add_tenant_consistent_foreign_keys.sql` |
| `20261117114343` | `add_business_scoped_unique_keys` | `20261117140000_add_business_scoped_unique_keys.sql` |
| `20261117120018` | `use_active_business_for_new_records` | `20261117150000_use_active_business_for_new_records.sql` |

This corrects the earlier interpretation: production version `20261117120018` is named `use_active_business_for_new_records`, not `add_business_ownership_columns`. The version numbers differ from repository filenames, but the migration names establish a strong intended mapping. The actual DDL and catalog effects must still be compared before considering the mapping fully reconciled.

## Remaining repository migration gap

Repository `main` has seven subsequent migrations after the mapped `use_active_business_for_new_records` migration that are not present in the production history returned on 2026-11-19:

1. `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql`
2. `20261117160000_add_business_invitations.sql`
3. `20261117170000_allow_legacy_business_membership_finance_reads.sql`
4. `20261118093000_project_wide_activity_notifications.sql`
5. `20261118154000_allow_audit_trigger_cross_business_logs.sql`
6. `20261118210000_store_location_stock_balances.sql`
7. `20261118220000_stock_transfer_workflows.sql`

The exact current production schema still requires semantic review. In particular, `audit_ledger_rpc_owner`, `store_locations`, `stock_balances` and `product_location_settings` were confirmed absent. The seven migrations must be assessed in dependency order, not applied one-by-one based only on timestamps.

## Key reconciliation status

- The first eight production versions after `20261117105432` now have repository filename candidates based on the exact migration names returned by Supabase.
- The ownership migration is not an unexplained timestamp mismatch: production records the migration name `add_business_ownership_columns` under version `20261117113408`, corresponding to repository file `20261117120000_add_business_ownership_columns.sql`.
- Production version `20261117120018` corresponds by name to repository `20261117150000_use_active_business_for_new_records.sql`.
- The seven later repository migrations remain the rollout candidates; the exact DDL/policy/function state must be validated against production catalog output.
- Do not mark repository migrations as applied, delete production history rows, or force a blind `supabase db push` to resolve numbering differences.

## Verified production object gaps

Read-only catalog inspection confirmed the absence of:
- `public.store_locations`
- `public.stock_balances`
- `public.product_location_settings`
- `audit_ledger_rpc_owner`

The application-reported 404s for store locations, stock balances and product location settings are consistent with missing relations, not a schema-cache-only problem.

## Required rollout work

1. Compare the actual production DDL/catalog effects of the eight mapped migration names against their repository SQL files, prioritizing ownership columns, composite FKs, unique indexes and active-business helper functions.
2. Review the seven unapplied repository migrations for dependencies, backfills, locks, destructive operations, grants, RLS, event triggers and function ownership.
3. Reconcile the production authorization baseline: 47 public tables have RLS enabled, but none has a restrictive policy; 36 have `business_id` and none has a restrictive tenant policy.
4. Review legacy-role fallback and the 85 SECURITY DEFINER functions, including seven that retain `search_path=public`.
5. Run clean isolated replay and two-business staging tests.
6. Require a complete encrypted independent backup and successful isolated restore rehearsal.
7. Obtain explicit approval for the exact candidate sequence, project ref and execution window.

## Current release decision

**BLOCKED — no production migration is approved for execution.**

Reasons:
- No complete manual backup and successful restore rehearsal has been confirmed.
- Seven later repository migrations remain unrecorded in production.
- The semantic equivalence review of the eight mapped migrations is not yet complete.
- Tenant/RPC owner role and location-aware inventory schema are missing.
- Strict tenant isolation and two-business staging acceptance remain outstanding.

This report records evidence and next steps only. It does not authorize production changes.
