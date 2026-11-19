# Production migration-history comparison — 2026-11-19

## Scope and method

This is a read-only comparison of:
- Production Supabase project ref: `phfpbqlhxagonpofzvtn`.
- Repository `main` migration directory inspected on 2026-11-19.
- Production `supabase_migrations.schema_migrations` rows queried on 2026-11-19.

No production DDL, DML, migration-history edit, schema-cache reload, or migration execution was performed.

## Confirmed production migration history

Production contains 70 migration-history rows. Its latest recorded version is `20261117120018`.

The complete ordered list was queried directly from production. The relevant tail after the common repository migration `20261117105432` is:

```text
20261117112228
20261117112246
20261117112249
20261117112251
20261117113408
20261117114039
20261117114343
20261117120018
```

These eight versions do not have exact timestamp-named counterparts in the repository `main` migration directory inspected in this comparison. Their origin and schema effects are not yet established. Do not infer equivalence from timestamp proximity.

## Repository migration tail

Repository `main` contains 76 SQL migration files total. Its relevant tail after `20261117105432` is:

```text
20261117120000_add_business_ownership_columns.sql
20261117130000_add_tenant_consistent_foreign_keys.sql
20261117140000_add_business_scoped_unique_keys.sql
20261117150000_use_active_business_for_new_records.sql
20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql
20261117160000_add_business_invitations.sql
20261117170000_allow_legacy_business_membership_finance_reads.sql
20261118093000_project_wide_activity_notifications.sql
20261118154000_allow_audit_trigger_cross_business_logs.sql
20261118210000_store_location_stock_balances.sql
20261118220000_stock_transfer_workflows.sql
```

These eleven repository migrations are not present as exact version strings in the production history queried on 2026-11-19. This does **not** prove that none of their effects exist: some earlier production versions may implement equivalent or partial changes. Actual schema equivalence must be established.

## Key divergence

The repository ownership migration is timestamped `20261117120000`, while production records `20261117120018`. Earlier inspection found that production already has some business-ownership schema elements, but the dedicated `audit_ledger_rpc_owner` role is absent and later inventory tables are absent.

Therefore, the first task is a semantic DDL equivalence review of production version `20261117120018` against repository migration `20261117120000_add_business_ownership_columns.sql`, followed by a mapping of each production-only version listed above to its originating SQL/source or actual catalog effects.

Do not mark `20261117120000` as applied, delete production history rows, or run a blind `supabase db push` to resolve this divergence.

## Verified production object gaps

Read-only catalog inspection confirmed the absence of:
- `public.store_locations`
- `public.stock_balances`
- `public.product_location_settings`
- `audit_ledger_rpc_owner`

The application-reported 404s for `store_locations` and `product_location_settings`, together with the earlier missing `stock_balances` error, are consistent with these missing relations. They are not fixed by a schema-cache reload alone.

The repository migration `20261118210000_store_location_stock_balances.sql` is the intended foundation for the first three tables, but it depends on tenant/RPC ownership and must not be applied in isolation. The subsequent `20261118220000_stock_transfer_workflows.sql` depends on that location-aware inventory foundation.

## Required reconciliation work

Before any production rollout:

1. Retrieve or recover the SQL source for all eight production-only versions. If their original migration files are unavailable, capture exact catalog definitions and reconstruct a reviewed equivalence map.
2. Compare the DDL, functions, triggers, indexes, constraints, grants, RLS flags and policies from production version `20261117120018` with repository ownership migration `20261117120000`.
3. Map each repository migration from `20261117130000` onward to production catalog state and production-only migration effects.
4. Identify overlapping, partially applied, and destructive operations. Review data backfills against live row counts and tenant ownership.
5. Produce a reviewed candidate migration plan that avoids duplicate DDL and never falsifies migration history.
6. Replay the candidate plan from a clean isolated database, then apply to representative staging data and test role/tenant isolation.
7. Require a complete, encrypted, independently stored backup and successful isolated restore rehearsal before release.
8. Obtain explicit approval for the exact candidate migration plan, project ref and execution window.

## Current release decision

**BLOCKED — no production migration is approved for execution.**

Reasons:
- No complete manual backup and successful restore rehearsal has been confirmed.
- Eight production-only migration versions have no exact repository counterparts.
- The ownership migration version mismatch has not been semantically reconciled.
- The tenant/RPC owner role and location-aware inventory schema are missing.
- Full candidate sequence and staging acceptance remain outstanding.

This report records evidence and next steps only. It does not authorize production changes.
