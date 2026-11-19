# Production schema rollout and migration-history reconciliation

## Purpose

This runbook protects the Audit Ledger production database from a blind migration push. It is a planning and verification procedure, not permission to change production.

## Last inspected production state

The production Supabase project was previously confirmed as active/healthy. A read-only inspection found:

- Latest recorded production migration version: `20261117120018`.
- The repository has a migration named `20261117120000_add_business_ownership_columns.sql`; its timestamp does not exactly match the production version.
- The production database did not contain `public.store_locations`, `public.stock_balances`, or `public.product_location_settings`.
- It did not contain the `audit_ledger_rpc_owner` role.
- It therefore cannot support the location-aware inventory/replenishment code currently being developed.
- Production schema inspection also found that multiple subsequent repository migrations had not been applied.

These are observations from the earlier inspection, not a claim that the database has remained unchanged. Re-run the included read-only preflight before any rollout.

## Dependency sequence to reconcile

The following repository migrations were identified as later than the observed production migration point:

1. `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql`
2. `20261117160000_add_business_invitations.sql`
3. `20261117170000_allow_legacy_business_membership_finance_reads.sql`
4. `20261118093000_project_wide_activity_notifications.sql`
5. `20261118154000_allow_audit_trigger_cross_business_logs.sql`
6. `20261118210000_store_location_stock_balances.sql`
7. `20261118220000_stock_transfer_workflows.sql`

The restricted `audit_ledger_rpc_owner` role and tenant/RPC ownership cutover are prerequisites for later store workflows. Do not apply the store-location or transfer migrations in isolation.

This list is a reconciliation starting point, not an instruction to apply these migrations in sequence without review. Migration `20261117120018` must first be mapped to the repository's ownership migration by comparing its actual DDL, constraints, policies, functions, and triggers. Migration history rows must never be edited merely to make the CLI appear synchronized.

## Required rollout procedure

1. **Read-only preflight.** Run `supabase/diagnostics/production-schema-rollout-preflight.sql` in the production SQL Editor. Save the complete results, including migration versions, object existence, RLS status and policies.
2. **Backup and recovery.** Confirm a current restorable backup or point-in-time recovery coverage. Verify the restore procedure and responsible operator. A backup that has never been restore-tested is not sufficient evidence of recovery readiness.
3. **Schema reconciliation.** Compare production objects against each repository migration. For the mismatched ownership version, establish whether the production migration is equivalent, partial, or materially different. Record every difference and the exact safe action. Do not mark migrations applied or delete history rows to bypass a mismatch.
4. **Isolated replay.** Replay the exact candidate migration sequence from an empty local Supabase database. Run the full database integration suite, frontend quality checks, Edge Function type checks and production build. Run Supabase security/performance advisors and review every finding relevant to the changed schema.
5. **Data preflight.** Review row counts, invalid or orphaned references, duplicate business-scoped keys, negative stock, missing verified inventory costs, active membership claims, and accounting balances. Any required backfill must be deterministic, idempotent, auditable, and separately reviewed.
6. **Staging validation.** Apply the candidate sequence to a non-production project with representative data. Verify owner/admin/accountant/cashier/auditor access, multi-business isolation, inventory balances, accounting journals, and rollback/recovery procedures.
7. **Explicit production approval.** Obtain explicit authorization for the exact project, migration set, timing, backup state, and any data backfill. General instructions to continue project development are not production database authorization.
8. **Controlled execution.** Use the reviewed deployment method and migration sequence. Monitor migration logs and application errors. Stop on unexpected schema/data differences; do not continue by forcing migration history.
9. **Post-deployment verification.** Re-run the preflight, verify expected tables/functions/policies/triggers, test Data API access and PostgREST schema exposure, and run authenticated smoke tests. Only request a schema-cache reload if the required database objects are confirmed present and the remaining issue is demonstrably cache-related.

## Non-negotiable safety rules

- No production DDL, DML, migration application, migration-history mutation, or cache reload is authorized by this document.
- Do not use `SECURITY DEFINER` as a shortcut around RLS. Review owner, grants, `search_path`, identity checks and execute privileges for every privileged function.
- Preserve tenant composite foreign keys, business-scoped RLS and audit trails.
- Do not weaken invoice/customer invariants or use fake customer records to bypass them.
- Inventory receiving, sales, transfers, cycle counts and reversals must be atomic and idempotent, with balanced accounting entries where applicable.
- Treat a successful local replay as necessary but not sufficient for production deployment.

## Acceptance evidence

Attach the following to the rollout change record:

- Preflight output before rollout.
- Migration-to-production equivalence map.
- Backup/PITR and restore-readiness confirmation.
- Clean isolated replay and full test results.
- Staging acceptance evidence by role and business.
- Explicit production approval.
- Applied migration list and post-deployment preflight output.
