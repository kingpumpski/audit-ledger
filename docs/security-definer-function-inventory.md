# Production SECURITY DEFINER function inventory

**Snapshot:** 2026-11-19  
**Project:** `phfpbqlhxagonpofzvtn`  
**Purpose:** Review the Supabase security-advisor warning for authenticated execution of SECURITY DEFINER functions. This is a point-in-time review, not a blanket revocation plan.

## Findings

Supabase's production security advisor reported 45 SECURITY DEFINER function signatures executable by `authenticated` through the public Data API. SECURITY DEFINER is not inherently unsafe: the application uses server-side transactional RPCs for atomic accounting and inventory operations. Every exposed signature must nevertheless have a documented authorization boundary, tenant binding, argument validation and execute-grant rationale.

Eight function families were inspected directly using read-only `pg_get_functiondef`, owner, configuration and ACL queries:

| Function family | Observed control | Review conclusion |
|---|---|---|
| `assign_user_role(uuid, app_role, uuid)` | Requires authenticated actor with global admin role; supplied grantor must equal `auth.uid()`; writes audit event | Retain only as an explicitly global administration capability. Verify the UI and policy intentionally distinguish global roles from business membership. It must not establish business data context. |
| `claim_initial_admin()` | Requires authenticated user; locks `user_roles` exclusively; only succeeds while role table is empty | One-time bootstrap RPC. Preserve the locking/empty-table guard and ensure no alternate bootstrap path exists. |
| `get_user_role(uuid)` | Self, global admin or service-role may inspect; other users receive NULL | Argument is caller-bound; retain only if global admin role inspection is an intended capability. |
| `has_any_role(uuid)` | Self, global admin or service-role may inspect role existence | Same global-role distinction; must not substitute for active business membership. |
| `has_permission(text, uuid)` | Non-service callers may query only their own user ID | Caller-bound. Preserve the self-only guard. |
| `set_business_member_access(uuid, uuid, text, text)` | Requires active business owner/admin membership; locks target business; validates role/status; prevents admins from granting owner/admin or modifying self; protects final active owner; writes audit record | Business-scoped membership-management RPC. Test owner/admin separation and concurrent last-owner changes. |
| `current_business_id()` | Production version includes a transitional fallback from global `user_roles` to the legacy workspace | Known tenant-boundary defect addressed by draft PR #98. Do not treat this production function as corrected until that migration is reviewed, merged and deployed. |
| `legacy_business_id()` | Returns the ID only when exactly one active legacy workspace exists | Compatibility helper; exposing the identifier is not membership authorization. Keep business access dependent on explicit active membership. |

## All 45 advisor-reported signatures

The following signatures were returned by the advisor. Each must be mapped to source migration, frontend/Edge Function call sites, intended caller roles, and a positive/negative authorization test before the production cutover is considered fully security-reviewed.

### Role, tenant and authorization helpers
- `assign_user_role(uuid, app_role, uuid)`
- `claim_initial_admin()`
- `current_business_id()`
- `get_user_role(uuid)`
- `has_any_role(text[])`
- `has_any_role(uuid)`
- `has_business_role(uuid, text[])`
- `has_permission(text)`
- `has_permission(text, uuid)`
- `has_role(app_role)`
- `has_role(uuid, app_role)`
- `is_business_member(uuid)`
- `is_first_user()`
- `legacy_business_id()`
- `set_business_member_access(uuid, uuid, text, text)`

### Business and operational transaction RPCs
- `create_business(text, text, text, text, text)`
- `create_invoice_draft(uuid, date, date, text, text, boolean, numeric, numeric, numeric, numeric, jsonb)`
- `issue_invoice(uuid)`
- `post_invoice_journal(uuid)`
- `create_receipt_with_payment(uuid, uuid, uuid, numeric, payment_method, uuid, text, text, text, text, text, text)`
- `record_invoice_payment(uuid, uuid, numeric, payment_method, uuid, text, text)`
- `record_invoice_payment(uuid, uuid, numeric, payment_method, text, text)`
- `record_invoice_credit_note(uuid, jsonb, date, text, text, uuid)`
- `apply_customer_credit(uuid, uuid, numeric, date, text, uuid)`
- `refund_customer_credit(uuid, numeric, date, payment_method, text, uuid)`
- `get_customer_account_balances(date, uuid)`
- `get_customer_credit_balances(uuid)`
- `get_payment_clearing_balances()`
- `get_payment_clearing_settlements()`
- `settle_payment_clearing_account(text, numeric, numeric, date, text, text, uuid, text)`
- `record_operating_expense(text, text, text, uuid, date, date, numeric, numeric, payment_method, text, text, uuid)`
- `pay_operating_expense(uuid, numeric, date, payment_method, text, uuid)`
- `record_operating_expense_refund(uuid, numeric, date, payment_method, text, uuid)`
- `reverse_unpaid_operating_expense(uuid, text, text, uuid)`
- `record_invoice_item_direct_cost(uuid, numeric, text, date, payment_method, text)`
- `set_historical_invoice_item_cost(uuid, numeric, text, text)`
- `record_stock_purchase(uuid, integer, numeric, text, text, numeric, payment_method, text, numeric, uuid)`
- `reverse_stock_purchase(uuid, date, payment_method, text, text, uuid)`
- `record_stock_count_adjustment(uuid, integer, date, text, text, uuid)`
- `record_inventory_damage(uuid, integer, text, uuid, text)`
- `reverse_petty_cash_expense(uuid, date, payment_method, text, text, uuid)`
- `void_receipt_and_reconcile(uuid)`
- `attest_financial_completeness(date, text, uuid)`
- `get_financial_completeness_attestation()`
- `get_next_sequence(text)`

## Release gates

1. Re-run the advisor and regenerate this inventory after any security migration.
2. Compare the exact production function signatures and definitions with repository migrations. Do not rely on function names alone; overloaded signatures are separate grants.
3. For every signature, record the source migration, frontend/Edge Function call sites, intended roles, owner, `search_path`, `row_security`, ACL and tenant authorization.
4. Test calls as anon, authenticated non-member, active owner, admin, accountant, cashier, auditor, suspended member, cross-business member and service role as appropriate.
5. Reject caller-supplied user IDs unless the function explicitly binds them to `auth.uid()` or verifies an authorized global administrator/service role.
6. Do not blanket-revoke the 45 signatures: that could break required atomic business workflows. Revoke only signatures proven internal/unneeded, and add regression tests for each ACL change.
7. Apply the dedicated RPC-owner/tenant policy migration only after complete backup/restore, clean replay, staging tests and explicit release approval.

## Additional production advisor items

- Leaked-password protection is disabled. Decide and document the Auth policy before production onboarding; changing it is an Auth configuration operation, not a schema migration.
- `pg_net` is installed in `public`. Check dependencies before considering relocation.
- The performance advisor reports 19 multiple-permissive-policy combinations and 143 unused indexes. Review policy OR semantics and index/FK/query-plan dependencies before changing anything. Do not drop indexes based on a low-traffic snapshot.
