# Production RLS and SECURITY DEFINER inventory — 2026-11-19

## Scope

Read-only catalog inspection of production project `phfpbqlhxagonpofzvtn`. No DDL, DML, grant changes, function changes or cache reloads were performed.

## RLS table coverage

The production catalog reported:

- 47 public ordinary/partitioned tables.
- 47 have row-level security enabled.
- 0 public tables in that scope have RLS disabled.

This is positive baseline evidence, but RLS-enabled does not by itself prove that policies are correct, restrictive tenant policies cover every business-owned table, or privileged functions enforce the same tenant boundary.

## SECURITY DEFINER inventory

The production catalog returned 63 public SECURITY DEFINER function signatures in the query scope. All returned functions were owned by `postgres` at inspection time, rather than the dedicated `audit_ledger_rpc_owner` role (which is absent).

Most functions had an empty configured search_path. Seven functions still had `search_path=public`:

- `public.audit_trigger_func()`
- `public.clear_reset_lockout(text,text)`
- `public.count_recent_reset_requests(text,text,integer)`
- `public.handle_new_user()`
- `public.is_reset_locked(text,text)`
- `public.products_set_sku_if_missing()`
- `public.register_reset_failure(text,text,integer,integer)`

The inspected definitions use schema-qualified references for most public relations, but the search-path configuration differs from the hardened empty-path pattern. These functions require individual review for name resolution, trigger execution context, grants, and whether they should be transferred to the restricted RPC owner or remain a narrowly scoped platform/trigger exception.

The current migration `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql` transfers public SECURITY DEFINER functions to `audit_ledger_rpc_owner` except its explicitly named DDL/event-trigger and internal Auth helper exceptions. The production inventory should be compared against that exclusion list, with particular attention to trigger functions and password-reset helper functions.

## Key release implications

1. Do not infer tenant isolation from the 47/47 RLS-enabled count.
2. Review every policy on business-owned tables for a restrictive business boundary and correct behavior for NULL/global records.
3. Review SECURITY DEFINER functions individually: owner, ACL, search_path, row_security, caller identity, business context, dynamic SQL and table access.
4. Confirm function owner role does not have BYPASSRLS and that row_security is on for the intended privileged routines.
5. Verify event-trigger functions remain owned by the migration/platform owner where DDL permissions require it; do not blindly transfer every SECURITY DEFINER function.
6. Test trigger-driven audit writes and auth-user creation under the proposed function owner and policy model.
7. Review password-reset helpers separately: their intended caller should be trusted server-side service role only, and email/IP inputs must not permit cross-user disclosure or lockout manipulation.

## Release decision

**BLOCKED for tenant/RPC security sign-off.**

The RLS count is encouraging, but the owner mismatch, transitional legacy fallback, seven public-search-path functions and unreviewed policy/function dependencies remain open. No production change was made.
