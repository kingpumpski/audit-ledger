# Production tenant/RPC authorization inspection — 2026-11-19

## Scope

Read-only inspection of production Supabase project `phfpbqlhxagonpofzvtn`. No production changes were made.

## Confirmed function ownership and execution mode

Catalog inspection returned these functions:

| Function | Owner | SECURITY DEFINER | search_path |
|---|---|---:|---|
| `public.current_business_id()` | postgres | yes | empty |
| `public.has_business_role(uuid,text[])` | postgres | yes | empty |
| `public.is_business_member(uuid)` | postgres | yes | empty |

The dedicated `audit_ledger_rpc_owner` role was independently confirmed absent.

An empty `search_path` is a useful hardening measure, but it does not by itself establish that ownership and grants match the repository's intended restricted-RPC-owner model. The exact execute grants, dependent policies and all callers still require review.

## Confirmed transitional authorization behaviour

The live definition of `public.current_business_id()` includes a compatibility fallback. When the JWT does not provide a valid active business membership, the function can return the legacy business ID when the authenticated user has any row in `public.user_roles`, even if that user does not have an active membership for that legacy business.

The live function definition itself labels this as transitional compatibility and says the coordinated tenant RLS cutover removes the global-role fallback.

This is material evidence that repository migration `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql` is a security-sensitive cutover, not merely a role-creation migration. It must be reconciled with the live function definition, grants, RLS policies, triggers and data before deployment.

## Required follow-up before cutover

1. Capture the complete definitions and owners for every security-definer function in the public schema, not only the three helpers above.
2. Capture execute privileges for PUBLIC, anon, authenticated, service_role and all custom roles.
3. Identify all RLS policies, views, triggers and RPCs that call `current_business_id()`, `is_business_member()` or `has_business_role()`.
4. Verify active/inactive membership rows and legacy user-role combinations without exporting personal data into the report.
5. Compare the exact repository migration `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql` against these production definitions and dependencies.
6. Replay the migration in a clean isolated database and run tests for legacy accounts, active and inactive memberships, users with global roles but no active membership, service-role operations and cross-business isolation.
7. Apply only as part of the reviewed, backed-up, explicitly approved migration release.

## Release decision

**BLOCKED.** Do not alter the production function, transfer ownership, change grants, or apply the tenant/RPC cutover until the full function/policy dependency review and complete verified backup/restore gate pass.

This is a diagnostic record, not an authorization to change production.
