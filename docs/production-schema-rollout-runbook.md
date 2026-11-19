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
- Production also records `20261112120819` named `restrict_security_definer_execute_grants`. The matching SQL was recovered from historical branch `fix/supabase-function-execute-grants`; draft PR #96 restores it in the repository using the production version identifier. PR #96 passed isolated replay and CI, but remains unmerged.
- Thus, 69 production migration entries map to current repository files by original timestamp or migration name; the remaining entry has recovered SQL proposed in PR #96.
- Read-only inspection confirmed `public.store_locations`, `public.stock_balances`, `public.product_location_settings` and role `audit_ledger_rpc_owner` are absent.
- All 47 public tables have RLS enabled; 36 have a `business_id` column, but none of the 47 has a RESTRICTIVE policy and none of the 36 business tables has a restrictive tenant policy.
- 85 public SECURITY DEFINER functions are owned by `postgres`; seven retain `search_path=public`.
- Production currently has one Auth user, one active business membership and one active business; no global-role user without a membership was found.
- Current stock preflight: 1 physical product, no negative-stock product, 1 positive-stock product, total quantity 2; the stocked product has a verified positive cost. This passes the location migration's negative-stock guard at inspection time only.

These are observations from 2026-11-19, not a claim that production has remained unchanged. Re-run the included read-only preflight before any rollout.

## Candidate dependency sequence

The seven migrations already present in repository `main` after `use_active_business_for_new_records` are supplemented by three reviewed forward-only corrections in draft PRs #97 and #98. The candidate order, subject to those PRs passing CI and merging, is:

1. `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql`
2. `20261117156000_require_active_membership_for_business_context.sql` — PR #98; pending CI at the time of this update. Removes global-role fallback from business context while retaining global project-role helpers.
3. `20261117160000_add_business_invitations.sql`
4. `20261117161000_fix_business_invitation_audit_scope.sql` — PR #97; isolated migration replay and tests passed.
5. `20261117170000_allow_legacy_business_membership_finance_reads.sql`
6. `20261118093000_project_wide_activity_notifications.sql`
7. `20261118154000_allow_audit_trigger_cross_business_logs.sql`
8. `20261118155000_scope_business_creation_audit_events.sql` — PR #97; isolated migration replay and tests passed.
9. `20261118210000_store_location_stock_balances.sql`
10. `20261118220000_stock_transfer_workflows.sql`

This is a candidate sequence, not an instruction to apply it. PR #97 and PR #98 are draft/unmerged; do not include their migrations in a production release unless those exact reviewed commits are merged and revalidated. The tenant/RPC cutover is a security boundary change and prerequisite for location-aware store workflows. Do not apply store-location or transfer migrations in isolation.

## Required rollout procedure

1. **Read-only preflight.** Run `supabase/diagnostics/production-schema-rollout-preflight.sql` in the production SQL Editor. Save the complete results, including migration versions/names, object existence, RLS status and policies.
2. **Backup and recovery.** Confirm a current complete backup stored independently of production and a successful isolated restore rehearsal. A database-only dump or untested backup is insufficient.
3. **Semantic reconciliation.** Compare mapped production migration names and recovered sources against their repository SQL files and actual production DDL/catalog effects. Migration name equality is a useful mapping, not proof of identical SQL. Record every difference.
4. **Review candidate migrations.** Inspect the ten candidate migrations for DDL, data backfills, locks, grants, RLS, function ownership, event triggers, dependencies and rollback/recovery behavior. Reconcile all object and policy state.
5. **Tenant security review.** Confirm membership-only business context, review all SECURITY DEFINER owners/ACLs/search_path/row_security, validate restrictive policies on every business-owned table, and test at least two businesses and cross-business access.
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
