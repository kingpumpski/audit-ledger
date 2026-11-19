# Production schema rollout and migration-history reconciliation

## Purpose

This runbook protects Audit Ledger production from a blind migration push. It is a planning and verification procedure, not permission to change production.

## Last inspected production state — 2026-11-19

Production Supabase project ref: `phfpbqlhxagonpofzvtn`; project status was previously confirmed ACTIVE_HEALTHY.

- Production contains 70 migration-history rows; latest version is `20261117120018`.
- Supabase migration listing supplies descriptive names. The eight versions after `20261117105432` map by name to repository migrations:
  - `20261117112228` → `business_tenancy_foundation` → `20261114170000_business_tenancy_foundation.sql`
  - `20261117112246` → `business_member_administration` → `20261116150000_business_member_administration.sql`
  - `20261117112249` → `index_business_membership_foreign_keys` → `20261116151000_index_business_membership_foreign_keys.sql`
  - `20261117112251` → `index_business_members_user_id` → `20261116152000_index_business_members_user_id.sql`
  - `20261117113408` → `add_business_ownership_columns` → `20261117120000_add_business_ownership_columns.sql`
  - `20261117114039` → `add_tenant_consistent_foreign_keys` → `20261117130000_add_tenant_consistent_foreign_keys.sql`
  - `20261117114343` → `add_business_scoped_unique_keys` → `20261117140000_add_business_scoped_unique_keys.sql`
  - `20261117120018` → `use_active_business_for_new_records` → `20261117150000_use_active_business_for_new_records.sql`
- Therefore, production version `20261117120018` is the active-business migration by name, not the ownership-columns migration. The earlier timestamp-only interpretation has been corrected.
- Seven repository migrations after that mapped active-business migration are not present in the production history list: tenant/RPC ownership cutover, business invitations, legacy finance membership reads, project-wide notifications, cross-business audit trigger handling, location stock balances and stock transfers.
- Read-only inspection confirmed `public.store_locations`, `public.stock_balances`, `public.product_location_settings` and role `audit_ledger_rpc_owner` are absent.
- All 47 public tables have RLS enabled; 36 have a `business_id` column, but none of the 47 has a RESTRICTIVE policy and none of the 36 business tables has a restrictive tenant policy.
- 85 public SECURITY DEFINER functions are owned by `postgres`; seven retain `search_path=public`.
- Production currently has one Auth user, one active business membership and one active business; no global-role user without a membership was found.

These are observations from 2026-11-19, not a claim that production has remained unchanged. Re-run the included read-only preflight before any rollout.

## Candidate dependency sequence

The following repository migrations remain after the production migration name `use_active_business_for_new_records`:

1. `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql`
2. `20261117160000_add_business_invitations.sql`
3. `20261117170000_allow_legacy_business_membership_finance_reads.sql`
4. `20261118093000_project_wide_activity_notifications.sql`
5. `20261118154000_allow_audit_trigger_cross_business_logs.sql`
6. `20261118210000_store_location_stock_balances.sql`
7. `20261118220000_stock_transfer_workflows.sql`

This is a candidate sequence, not an instruction to apply it. The tenant/RPC cutover is a security boundary change and prerequisite for location-aware store workflows. Do not apply store-location or transfer migrations in isolation.

## Required rollout procedure

1. **Read-only preflight.** Run `supabase/diagnostics/production-schema-rollout-preflight.sql` in the production SQL Editor. Save the complete results, including migration versions/names, object existence, RLS status and policies.
2. **Backup and recovery.** Confirm a current complete backup stored independently of production and a successful isolated restore rehearsal. A database-only dump or untested backup is insufficient.
3. **Semantic reconciliation.** Compare the eight mapped production migration names against their repository SQL files and actual production DDL/catalog effects. Migration name equality is a useful mapping, not proof of identical SQL. Record every difference.
4. **Review candidate migrations.** Inspect the seven remaining migrations for DDL, data backfills, locks, grants, RLS, function ownership, event triggers, dependencies and rollback/recovery behavior. Reconcile all object and policy state.
5. **Tenant security review.** Resolve the retained global-role fallback in `current_business_id()`; review all SECURITY DEFINER owners/ACLs/search_path/row_security; validate restrictive policies on every business-owned table; test at least two businesses and cross-business access.
6. **Isolated replay.** Replay the exact candidate migration sequence from a clean local Supabase database. Run the full database integration suite, frontend quality checks, Edge Function type checks and production build. Run security/performance advisors and review relevant findings.
7. **Data preflight.** Review row counts, invalid/orphaned references, duplicate business-scoped keys, negative stock, missing verified inventory costs, active membership claims and accounting balances. Any backfill must be deterministic, idempotent, auditable and separately reviewed.
8. **Staging validation.** Apply the candidate sequence to a non-production project with representative data for at least two businesses. Verify owner/admin/accountant/cashier/auditor access, tenant isolation, inventory balances, accounting journals and recovery procedures.
9. **Explicit production approval.** Obtain explicit authorization for the exact project, migration set, timing, backup state and any data backfill. General instructions to continue development are not production database authorization.
10. **Controlled execution.** Use the reviewed deployment method and migration sequence. Stop on unexpected schema/data differences; do not force migration history.
11. **Post-deployment verification.** Re-run the preflight, verify expected tables/functions/policies/triggers, test Data API access and PostgREST schema exposure, and run authenticated smoke tests. Reload schema cache only if objects exist and the remaining issue is demonstrably cache-related.

## Non-negotiable safety rules

- No production DDL, DML, migration application, migration-history mutation or cache reload is authorized by this document.
- Do not use SECURITY DEFINER as a shortcut around RLS. Review owner, grants, search_path, row_security, identity checks and execute privileges for every privileged function.
- Preserve tenant composite foreign keys, business-scoped RLS and audit trails.
- Do not weaken invoice/customer invariants or use fake customer records to bypass them.
- Inventory receiving, sales, transfers, cycle counts and reversals must be atomic and idempotent, with balanced accounting entries where applicable.
- A successful local replay is necessary but not sufficient for production deployment.

## Acceptance evidence

Attach the following to the rollout change record:

- Preflight output before rollout.
- Production migration-name-to-repository-file map and semantic equivalence findings.
- Complete backup manifest and successful isolated restore evidence.
- Clean isolated replay and full test results.
- Two-business staging acceptance evidence by role.
- Explicit production approval.
- Applied migration list and post-deployment preflight output.
