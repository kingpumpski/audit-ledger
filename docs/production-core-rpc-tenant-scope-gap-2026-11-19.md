# Production core RPC tenant-scope verification — 2026-11-19

## Scope and safety

Read-only inspection of Supabase production project `phfpbqlhxagonpofzvtn` on 2026-11-19. Queried live SECURITY DEFINER catalog definitions and selected invoice/payment RPC bodies. No production DDL, DML, grants, function definitions, migration history, Auth settings or schema cache were changed.

This document supplements the broader migration-history, RLS and SECURITY DEFINER inventories. It records current live production behavior, not the behavior proposed in unmerged pull requests.

## Confirmed live catalog state

- Project status: `ACTIVE_HEALTHY`, PostgreSQL 17.11.
- Public SECURITY DEFINER routines returned by the catalog query are owned by `postgres`.
- Dedicated role `audit_ledger_rpc_owner` was not present in the earlier production role inspection.
- Production migration history last inspected in the rollout preflight remains at version `20261117120018`; follow-up tenant/RPC, finance RPC and payment-clearing migrations are not recorded as applied.
- The catalog query found 85 public SECURITY DEFINER routines in the full inventory. A narrower function query confirmed that the core finance RPCs below still have their pre-tenant-scoped definitions.

## Core live RPCs requiring coordinated tenant binding

The following production definitions were inspected directly using `pg_get_functiondef`:

| Function | Live production authorization/tenant observation |
|---|---|
| `create_invoice_draft(uuid,date,date,text,text,boolean,numeric,numeric,numeric,numeric,jsonb)` | Checks global `has_any_role(admin/accountant/cashier)`; customer, product and tax lookups are not explicitly bound to the active business in the function body. |
| `issue_invoice(uuid)` | Checks global role; selects and updates invoice by ID without an explicit active-business predicate. |
| `record_invoice_payment(uuid,uuid,numeric,payment_method,uuid,text,text)` | Checks global role; idempotency lookup is by key; inserts payment by caller-supplied invoice/customer IDs without an explicit business binding in the function body. |
| `create_receipt_with_payment(...)` | Checks global role; payment/receipt lookups and inserts are not explicitly scoped to active business in the function body. |
| `apply_customer_credit(uuid,uuid,numeric,date,text,uuid)` | Checks global role; credit note, invoice, chart-of-accounts and company-settings operations are not explicitly business-scoped in the live definition. |
| `attest_financial_completeness(date,text,uuid)` | Checks global role; reporting-date checks and evidence digest call are global in the live definition. |
| `get_customer_account_balances(date,uuid)` | Live signature/body has no explicit active-business binding. |
| `get_customer_credit_balances(uuid)` | Live signature/body has no explicit active-business binding. |
| `get_payment_clearing_balances()` and `get_payment_clearing_settlements()` | Live definitions are not the business-scoped versions proposed in PR #107. |
| `settle_payment_clearing_account(...)` | Live definition is not the active-business-scoped version proposed in PR #107. |

A text search for `business_id`, `current_business_id()` and `has_business_role()` was also run over public non-trigger SECURITY DEFINER functions. Many core transaction functions returned false for all three indicators. This is a triage signal, not a complete proof of exploitability: authorization may also be enforced by row-level security, foreign keys, helper functions or trigger paths. Each routine still needs full semantic review and cross-business tests.

## Important distinction: repository PRs are not production behavior

The following PR branches contain proposed fixes, but remain unmerged and unapplied to production at the time of this inspection:

- PR #107 — payment-clearing RPCs and settlements.
- PR #109 — receivables, customer credit and financial-attestation RPCs.
- PR #98 — active-business membership context.
- PR #97 — business invitation and audit-event scope.
- PR #106 — audit-log client query/cache scope.
- PR #102–#105 — invoice/payment, customer/product, company-settings/receivables and tax/discount client query/cache scope.

CI success on those branches does not change production database functions or policies.

## Required implementation and acceptance work

1. Treat each RPC as a coordinated authorization boundary: derive the active business from the trusted authenticated context; verify the caller's active membership and role; never trust a client-supplied business ID as authorization.
2. Verify all referenced parent rows (customer, invoice, product, tax, credit note, payment, journal entry, account and company settings) belong to the same business before mutation or aggregation.
3. Include `business_id` in new transaction rows and in idempotency scope/fingerprints where keys can be reused across businesses.
4. Scope journal lines and journal entries together; a tenant-scoped parent query alone is insufficient if the aggregation can include another tenant's lines.
5. Keep atomic accounting invariants: balanced journals, non-negative receivables/credits, correct payment allocation, immutable issued documents, safe retry behavior and reversal audit trails.
6. Review trigger functions separately. A trigger's SECURITY DEFINER owner and RLS behavior must be compatible with the tenant boundary; do not blindly transfer trigger owners.
7. Add database tests with at least two businesses and distinct owner, accountant, cashier and read-only identities. Assert that cross-business invoice IDs, customer IDs, product IDs, payment IDs, idempotency keys and RPC arguments are rejected and that no other tenant's balances or journal evidence are returned.
8. Validate the final merged migration chain by clean isolated replay and database integration tests, then run authenticated staging acceptance against representative multi-business data.
9. Complete the independent encrypted backup and isolated restore rehearsal before any production tenant/RPC cutover.
10. Re-run the live catalog/function/ACL/policy preflight immediately before release and obtain explicit approval for the exact production migration sequence.

## Release decision

**BLOCKED — core production invoice/payment and finance RPC tenant isolation is not yet verified or deployed.**

Do not infer safety from the production project's `ACTIVE_HEALTHY` status, the presence of RLS on tables, or passing CI on unmerged PRs. No production writes were performed during this inspection.
