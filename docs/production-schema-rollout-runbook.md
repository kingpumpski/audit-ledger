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
- Read-only inspection confirmed these objects are absent: `public.store_locations`, `public.stock_balances`, `public.product_location_settings`, `public.business_invitations`, `public.stock_transfers`, `public.stock_transfer_lines`, `public.stock_transfer_receipts`, `public.stock_transfer_receipt_lines`, `public.store_stock_counts`, `public.store_stock_count_lines`, `public.suppliers`, and `public.supplier_products`. Role `audit_ledger_rpc_owner` is also absent.
- All 47 public tables have RLS enabled; 36 have a `business_id` column, but none of the 47 has a RESTRICTIVE policy and none of the 36 business tables has a restrictive tenant policy.
- 85 public SECURITY DEFINER functions are owned by `postgres`; seven retain `search_path=public`.
- Production currently has one Auth user, one active business membership and one active business; no global-role user without a membership was found.
- Current stock preflight: 1 physical product, no negative-stock product, 1 positive-stock product, total quantity 2; the stocked product has a verified positive cost. This passes the location migration's negative-stock guard at inspection time only.

These are observations from 2026-11-19, not a claim that production has remained unchanged. Re-run the included read-only preflight before any rollout.

## Candidate dependency sequence

The production rollout must reconcile the already-applied historical migration `20261112120819` with PR #96's restored source file first. It is already recorded in production and must not be applied a second time. On a clean isolated replay, it belongs at its historical timestamp before later migrations.

Subject to review, merge and fresh validation of the corresponding PRs, the later candidate sequence is:

1. `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql` — tenant restrictive policies, constrained SECURITY DEFINER owner and future-object event triggers.
2. `20261117156000_require_active_membership_for_business_context.sql` — PR #98; removes global-role fallback from business data context.
3. `20261117160000_add_business_invitations.sql` — business invitation lifecycle.
4. `20261117161000_fix_business_invitation_audit_scope.sql` — PR #97; ensures invitation audit events carry the tenant business ID.
5. `20261117170000_allow_legacy_business_membership_finance_reads.sql` — preserves intended legacy finance reads under explicit membership.
6. `20261118093000_project_wide_activity_notifications.sql` — notification pipeline.
7. `20261118154000_allow_audit_trigger_cross_business_logs.sql` — trusted audit-trigger insert policy needed for new-business creation.
8. `20261118155000_scope_business_creation_audit_events.sql` — PR #97; scopes business-root audit events to the new business.
9. `20261118210000_store_location_stock_balances.sql` — store locations, per-location balances and product/location settings. Requires tenant/RPC cutover and the trusted audit-trigger setup.
10. `20261118220000_stock_transfer_workflows.sql` — transfer workflow, depends on store locations and balances.
11. `20261118225000_business_scoped_chart_of_accounts.sql` — PR #85; business-specific chart seed and inventory variance accounts. Depends on business membership and the existing legacy system chart template.
12. `20261118230000_store_cycle_count_workflows.sql` — PR #85; location-scoped count/approval/posting, depends on store locations, stock balances and journal/accounting structures.
13. `20261119100000_business_role_sequence_authorization.sql` — PR #85; updates shared sequence authorization for business-scoped roles. Must follow the strict membership context migration.
14. `20261119120000_supplier_directory_foundation.sql` — PR #89; supplier and supplier-product master data. Depends on business-scoped products, tenant RLS infrastructure and the audit trigger; its integration tests also exercise store locations.
15. PR #86 replenishment is currently frontend/helper-only and adds no migration. It is stacked on PR #85's cycle-count branch and must be retargeted/rebased and receive fresh CI after PR #85 is merged.

PR #96 restores a historical migration source, PR #97 adds two audit corrections, PR #98 adds strict membership context, PR #85 adds three store/accounting migrations, and PR #89 adds supplier master-data tables. These PRs are currently draft/unmerged. The order above is a dependency candidate, not a production execution instruction. Validate the exact merged files and all intervening repository migrations before release. Do not apply the store-location, transfer, chart, cycle-count, sequence or supplier migrations independently of their prerequisites.

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


## Supabase advisor snapshot — 2026-11-19

Read-only Supabase advisors were run against production project `phfpbqlhxagonpofzvtn`. These findings are diagnostic, not automatic permission to change production.

### Security advisor
- `authenticated_security_definer_function_executable`: **45** SECURITY DEFINER overloads/functions are callable by `authenticated` through the public Data API. Some are intended transactional RPCs; others are identity/authorization helpers or role-management functions. Review each exact signature against application call sites, function body, caller identity checks, grants, owner, fixed `search_path`, tenant context and RLS behavior. Do not blanket-revoke all 45 or assume all are safe.
- High-priority signatures for explicit review include `claim_initial_admin()`, `assign_user_role(uuid, app_role, uuid)`, `get_user_role(uuid)`, `has_any_role(uuid)`, `has_permission(text, uuid)`, `set_business_member_access(uuid, uuid, text, text)`, `legacy_business_id()`, `current_business_id()`, `create_business(...)`, and financial/inventory posting RPCs.
- `auth_leaked_password_protection`: leaked-password protection is disabled. Enable only after confirming supported Auth configuration, user impact and operational policy; do not alter Auth settings as part of a schema migration.
- `extension_in_public`: `pg_net` is installed in `public`. Review dependency and extension relocation compatibility before moving it; do not move it blindly.

### Performance advisor
- `multiple_permissive_policies`: **19** policy/action combinations have multiple permissive policies for `authenticated`. PostgreSQL ORs permissive policies, so verify that each combination preserves intended tenant and role semantics. Consolidate only after policy-by-policy tests; do not simply drop policies.
- `unused_index`: **143** indexes were reported unused at the observation time. This may reflect low production traffic or recently created indexes. Do not drop indexes from this snapshot; first inspect index definitions, FK support, query plans, table write costs and representative workload history.

### Acceptance before production release
1. Produce a function-signature inventory classifying every SECURITY DEFINER function as public RPC, internal helper, trigger-only, or service-only.
2. For each public RPC, test unauthenticated, authenticated non-member, active member by role, suspended member, cross-business user and service-role calls.
3. Confirm all SECURITY DEFINER functions have intentional ownership, explicit execute grants, safe `search_path`, correct identity binding and tenant checks. Pay particular attention to any function accepting a caller-supplied user ID.
4. Review all 19 multiple-permissive-policy combinations for tenant-scope equivalence and role semantics.
5. Defer unused-index cleanup until production query statistics and FK dependencies justify each removal.
6. Record whether leaked-password protection is enabled and the reviewed Auth policy before inviting production users.

These advisor counts are point-in-time values and must be refreshed before rollout.

## Render deployment topology snapshot — 2026-11-19

The connected Render workspace currently contains **two active static-site services** connected to the same repository and branch:

| Service | URL | Service ID | Current deployment |
|---|---|---|---|
| `bredas-receipt` | `https://bredas-receipt.onrender.com` | `srv-d94vtfvlk1mc73c08ea0` | Live, commit `e8811c482e12984e050cb9159c0748e87e849761` |
| `breda-receipt` | `https://breda-receipt.onrender.com` | `srv-d9362mu7r5hc73a7bks0` | Live, same commit `e8811c482e12984e050cb9159c0748e87e849761` |

Both use branch `main`, root directory `/`, build command `bun install && bun run build`, and publish directory `dist`. Both deployments completed successfully on 2026-11-19 at approximately 07:41 UTC. The two Render deployments therefore appear to be duplicate hosting targets, not separate application environments.

**Do not delete or suspend either service yet.** Confirm which URL is canonical, whether custom domains or users depend on either hostname, and whether both are intentionally retained. Then consolidate to one canonical service with an explicit rollback plan. An HTTP page fetch could not be independently completed in this inspection, so Render's `live` deployment state is not represented as an end-to-end browser acceptance test.

No dedicated Audit Ledger backup worker or backup object-storage service was found in the connected Render workspace. The existing two static sites cannot execute the proposed trusted backup/restore worker. No service was created, upgraded, or modified.
