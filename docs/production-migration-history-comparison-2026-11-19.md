# Production migration-history comparison — 2026-11-19

## Scope and method

Read-only comparison of:
- Production Supabase project ref: `phfpbqlhxagonpofzvtn`.
- Repository `main` migration directory inspected on 2026-11-19.
- Production migration history returned by Supabase's migration listing and queried `supabase_migrations.schema_migrations`.
- Historical Git branch migration sources where the current `main` migration file was missing.

No production DDL, DML, migration-history edit, schema-cache reload, or migration execution was performed.

## Confirmed production migration history

Production contains 70 migration-history rows. Its latest recorded version is `20261117120018`.

The repository migration filenames and production version values have been renumbered in multiple cases. Supabase's migration listing preserves descriptive names, and those names/original timestamps allow a source mapping for 69 of the 70 production entries against the inspected repository main files. The remaining production entry is also recoverable from a historical branch.

The eight production versions after `20261117105432` map as follows:

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

This corrects the earlier interpretation: production version `20261117120018` is the active-business migration by name, not the ownership-columns migration.

## Missing repository source recovered: security-definer grants

Production migration listing also contains:

- Version: `20261112120819`
- Name: `restrict_security_definer_execute_grants`

The exact SQL was recovered from historical branch `fix/supabase-function-execute-grants`, where it existed as `20261112130000_restrict_security_definer_execute_grants.sql`. Production ACL inspection confirms the effects on the seven named functions: API roles do not retain direct execution, and the password-reset helpers are executable by `service_role`.

The current `main` branch lacked this migration source. Draft PR #96 restores it as `20261112120819_restrict_security_definer_execute_grants.sql`, using the production version identifier so:
- a clean replay includes the migration at its historical position;
- production migration tooling recognizes that version as already applied;
- the existing production migration history is not edited.

This source restoration still needs clean replay CI and review before merge. Production has not been changed.

## Remaining repository migration gap

Seven repository migrations after the mapped `use_active_business_for_new_records` migration are not present in production history:

1. `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql`
2. `20261117160000_add_business_invitations.sql`
3. `20261117170000_allow_legacy_business_membership_finance_reads.sql`
4. `20261118093000_project_wide_activity_notifications.sql`
5. `20261118154000_allow_audit_trigger_cross_business_logs.sql`
6. `20261118210000_store_location_stock_balances.sql`
7. `20261118220000_stock_transfer_workflows.sql`

The exact current production schema still requires semantic review. In particular, `audit_ledger_rpc_owner`, `store_locations`, `stock_balances` and `product_location_settings` were confirmed absent. The seven migrations must be assessed in dependency order, not applied one-by-one based only on timestamps.

## Reconciliation summary

- 70 production migration-history entries were inspected.
- 69 production entries map to current repository main migration files by descriptive name or embedded original timestamp.
- The remaining production entry `restrict_security_definer_execute_grants` has been recovered from a historical branch and is proposed for restoration in PR #96.
- Seven later repository migrations remain unrecorded in production.
- Migration names and source mapping are strong evidence of intended correspondence, not proof of identical SQL. The mapped DDL and actual catalog effects still require review.
- Do not mark repository migrations as applied, delete production history rows, or force a blind `supabase db push` to resolve numbering differences.

## Verified production object and security gaps

Read-only inspection confirmed the absence of:
- `public.store_locations`
- `public.stock_balances`
- `public.product_location_settings`
- `audit_ledger_rpc_owner`

Production has 47 public tables with RLS enabled, but none currently has a RESTRICTIVE policy; 36 tables have `business_id`, and none of those has a restrictive tenant policy. There are 85 public SECURITY DEFINER functions, all owned by `postgres`; seven retain `search_path=public`. The proposed tenant/RPC cutover and function ownership change therefore require full two-business staging tests.

## Required rollout work

1. Review the seven unapplied migrations for dependencies, backfills, locks, destructive operations, grants, RLS, event triggers and function ownership.
2. Compare the 70 mapped production migration sources with their repository SQL and actual production catalog state, prioritizing tenant ownership, composite FKs, unique indexes, helper functions and security-definer grants.
3. Resolve the retained global-role fallback in `current_business_id()` and validate signup, bootstrap, invitations and active-business claim flows.
4. Validate restrictive policies on every business-owned table and all privileged RPC/trigger execution paths.
5. Run clean isolated replay and two-business staging tests.
6. Require a complete encrypted independent backup and successful isolated restore rehearsal.
7. Obtain explicit approval for the exact candidate sequence, project ref and execution window.

## Current release decision

**BLOCKED — no production migration is approved for execution.**

Reasons:
- No complete manual backup and successful restore rehearsal has been confirmed.
- Seven later repository migrations remain unrecorded in production.
- The semantic equivalence review of mapped migration sources is not yet complete.
- Tenant/RPC owner role and location-aware inventory schema are missing.
- Strict tenant isolation and two-business staging acceptance remain outstanding.

This report records evidence and next steps only. It does not authorize production changes.
