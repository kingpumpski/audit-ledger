# Production RLS policy baseline — tenant isolation gap — 2026-11-19

## Scope

Read-only catalog inspection of production Supabase project `phfpbqlhxagonpofzvtn`. No production changes were made.

## Catalog facts

- 47 public tables have RLS enabled.
- 36 of those tables have a `business_id` column.
- 0 of the 47 tables currently has a RESTRICTIVE RLS policy.
- 0 of the 36 business_id tables currently has a RESTRICTIVE RLS policy.
- Core-table policy definitions inspected for products, customers, invoices, invoice_items, payments, receipts and journal entries use role-helper predicates such as `has_role(...)` and `has_any_role(...)`, rather than a direct `business_id = current_business_id()` predicate.

This does not, by itself, prove that cross-business data is currently present or has been exposed. It does establish that production has not yet received the restrictive tenant-scope policy layer defined by repository migration `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql`.

## Security significance

RLS being enabled is necessary but not sufficient for tenant isolation. PostgreSQL combines permissive policies with OR semantics; without a restrictive tenant boundary, an existing role-based permissive policy can allow access to rows from more than the intended active business if a user has the relevant global role.

The proposed cutover introduces restrictive `tenant_business_scope` policies for business-owned tables with `business_id`, while adding a dedicated no-login, NOBYPASSRLS function owner. This is a significant security boundary change and must be validated carefully.

## Required pre-cutover validation

1. Confirm the complete production business and membership population.
2. Inventory users with global roles and no membership records; determine a safe membership backfill.
3. For every business-owned table, compare existing permissive policies, proposed restrictive policy, NULL/global-row semantics and service-role behavior.
4. Confirm excluded tables (`business_members`, `business_invitations`, `notifications`) have their own recipient/business authorization rules.
5. Test direct PostgREST reads/writes and every RPC under two or more distinct business identities.
6. Test cross-business joins and foreign-key violations; composite tenant FKs must reject cross-business references.
7. Verify all trigger and SECURITY DEFINER paths respect the active business boundary after function ownership changes.
8. Use representative staging data containing at least two businesses and distinct owners/admins/accountants/cashiers/auditors. A single-business smoke test is insufficient.
9. Obtain a complete verified backup and isolated restore before any production migration.

## Release decision

**BLOCKED for multi-tenant production sign-off.**

The current production policy set has RLS enabled but lacks restrictive business-scope policies. The proposed tenant cutover is required for the intended multi-business model, but it is not safe to apply until legacy membership, function-owner, policy and cross-tenant regression checks pass.

No production DDL/DML, grant change, migration-history change, or schema-cache reload was performed.
