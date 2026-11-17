# Business tenancy ownership contract

## Status

This document is the schema and authorization contract for phase 2 of business tenancy. It is intentionally based on the production schema observed after release `5e92f344b00ec29fd4b42cc4f5e996ac145dc4a0` and on the additive workspace foundation proposed in PR #48.

**This document does not claim that tenant isolation is live.** Operational tables currently have no `business_id`; do not enable tenant-only RLS or expose a business switcher as if records were isolated until the ownership migration, RPC changes, and frontend context ship together.

## Non-negotiable invariants

1. Every business-owned record has exactly one non-null `business_id` after cutover.
2. Existing production records are assigned to the seeded `legacy_workspace` without changing their financial values, identifiers, dates, or audit history.
3. Every relationship between business-owned records is tenant-consistent. A child cannot reference a parent from another business even if the UUID is known.
4. Every read, insert, update, delete, report, export, search, realtime subscription, and privileged RPC is scoped to an active membership in the requested business.
5. A client-supplied `business_id` is never trusted by itself. The database validates membership and role on every write path.
6. Financial posting remains atomic and idempotent. Tenant validation must happen before any ledger, inventory, payment, receipt, or balance mutation.
7. A user may belong to multiple businesses. Legacy global roles are a migration bridge only; they must not grant cross-business access after cutover.
8. Membership administration protects the final active owner. Suspended/archived businesses and suspended memberships cannot transact.
9. System reference data is explicitly classified as global or business-owned; it is never silently shared.
10. Rollout is additive and staged. Do not enable restrictive tenant RLS until all rows are backfilled, all RPCs are tenant-aware, and frontend requests consistently supply the active business.

## Production table ownership inventory

### Business-owned roots

These records receive a direct, non-null `business_id` after the staged backfill:

| Table | Ownership rule |
| --- | --- |
| `customers` | Directly owned by one business |
| `products` | Directly owned by one business; SKU uniqueness is business-scoped |
| `invoices` | Directly owned; customer and discount must belong to the same business |
| `payments` | Directly owned; invoice/customer references must be tenant-consistent |
| `receipts` | Directly owned; payment/invoice/customer references must be tenant-consistent |
| `operating_expenses` | Directly owned; expense account must belong to the same business |
| `petty_cash_transactions` | Directly owned |
| `chart_of_accounts` | Directly owned; account codes and names are business-scoped |
| `journal_entries` | Directly owned |
| `taxes` | Directly owned; liability account must belong to the same business |
| `discounts` | Directly owned |
| `company_settings` | One settings record per business; migrate current singleton to legacy workspace |
| `sequences` | Business-scoped numbering; unique key is (`business_id`, `name`) |

### Business-owned dependent records

These records also carry `business_id` as a denormalized integrity and RLS key. Their parent relationship must be enforced with tenant-aware composite foreign keys (or an equivalent database-enforced constraint), not only application checks:

| Table | Required same-business parent(s) |
| --- | --- |
| `invoice_items` | `invoices`, and optional `products` |
| `invoice_taxes` | `invoices`, `taxes`, `chart_of_accounts` |
| `invoice_item_taxes` | `invoices`, `invoice_items`, `taxes`, `chart_of_accounts` |
| `invoice_item_direct_costs` | `invoice_items`, `journal_entries` |
| `credit_notes` | `invoices`, `customers`, optional `journal_entries` |
| `credit_note_lines` | `credit_notes`, `invoice_items`, optional `products` |
| `credit_note_line_taxes` | `credit_note_lines`, `invoice_item_taxes`, `taxes`, `chart_of_accounts` |
| `customer_credit_applications` | `credit_notes`, `invoices`, optional `journal_entries` |
| `customer_credit_refunds` | `credit_notes`, optional `journal_entries` |
| `inventory_transactions` | `products` |
| `inventory_count_adjustments` | `products`, `inventory_transactions`, optional `journal_entries` |
| `inventory_purchase_reversals` | Original and reversal `inventory_transactions`, optional `journal_entries` |
| `product_price_history` | `products` |
| `operating_expense_payments` | `operating_expenses`, optional `journal_entries` |
| `operating_expense_refunds` | `operating_expenses`, optional `journal_entries` |
| `operating_expense_reversals` | `operating_expenses`, optional `journal_entries` |
| `petty_cash_expense_reversals` | `petty_cash_transactions`, `journal_entries` |
| `payment_clearing_settlements` | `chart_of_accounts`, `journal_entries` |
| `journal_lines` | `journal_entries`, `chart_of_accounts` |
| `financial_completeness_attestations` | The attested business ledger/reporting period; store business scope explicitly |

### User-scoped or platform-global records

These must not be assigned to a business merely to make every table look uniform:

| Table | Classification and access rule |
| --- | --- |
| `profiles` | User identity/profile; own profile and separately authorized administrative access |
| `user_mfa` | User security data; only the owning user and tightly scoped security workflows |
| `password_history` | User security data; never business-readable |
| `password_reset_attempts` | User security data; server-controlled |
| `password_reset_lockouts` | User security data; server-controlled |
| `password_reset_tokens` | User security data; server-controlled, never client-readable |
| `password_policy` | Platform security configuration unless a deliberate per-business policy feature is designed |
| `user_roles` | Transitional platform-level role assignments; remove their ability to grant operational cross-tenant access at cutover |
| `permissions` | Platform permission catalogue |
| `role_permissions` | Platform role-to-permission catalogue; business-specific role overrides require a separate explicit model |
| `notifications` | User-owned delivery records; add optional business context only where the event is business-specific |
| `audit_logs` | Must carry nullable business context for business events while preserving platform/user security events; enforce visibility by membership and audit privilege |
| `businesses` | Tenant root |
| `business_members` | Tenant membership and role assignments |

## Tenant-aware key and relationship strategy

- Introduce unique constraints on parent keys such as (`business_id`, `id`) where needed for composite foreign keys.
- Replace global uniqueness for customer codes, product SKUs, invoice numbers, receipt numbers, payment numbers, and account codes with business-scoped uniqueness. Preserve legacy values exactly.
- Numbering sequences must be keyed by business and sequence type; no global sequence counter may leak activity between businesses.
- Add indexes beginning with `business_id` for tenant-filtered access paths, including common date/status and foreign-key lookups.
- For every child relationship, add a composite FK using `business_id` plus the parent identifier. Validate existing rows before making constraints mandatory.
- Do not use a trigger that silently overwrites a supplied `business_id`; reject mismatches and derive or verify ownership from the authoritative parent inside the transaction.

## Required database authorization contract

- Implement `current_business_id()` only if the application has a secure, transaction-safe active-business context. A mutable global session setting alone is not an authorization boundary.
- Prefer explicit business identifiers in RPC signatures and verify `has_business_role(business_id, allowed_roles)` inside every SECURITY DEFINER function.
- All SECURITY DEFINER functions must use an empty search path and schema-qualified objects.
- Revoke PUBLIC/anon execution from tenant RPCs. Grant authenticated only where the function itself validates membership and role.
- RLS policies must use active membership and least-privilege business roles. SELECT access for auditors must not imply INSERT/UPDATE/DELETE.
- Parent-child inserts and updates must validate that every referenced entity belongs to the same business.
- Realtime publication, Storage paths, exports, generated PDFs, dashboard aggregates, and Edge Functions must use the same business boundary.
- No direct membership writes from clients. Invitations, acceptance, role changes, suspension, and ownership transfer go through audited RPCs with last-owner protection.

## Safe rollout sequence

1. **Foundation** — merge/release the workspace and membership primitives only after reviewing their migration and CI. Keep legacy operational policies unchanged.
2. **Inventory and rehearsal** — snapshot row counts, foreign-key relationships, uniqueness collisions, company settings, sequences, and financial control totals. Build a deterministic ownership backfill to the legacy workspace.
3. **Additive ownership columns** — add nullable `business_id` columns and tenant indexes to root and dependent tables. Backfill in dependency order. Do not change user-visible authorization yet.
4. **Integrity enforcement** — add and validate tenant-aware composite foreign keys and scoped unique constraints. Verify all rows have one valid business owner.
5. **RPC and Edge Function migration** — add explicit business context and membership/role checks to every financial, inventory, reporting, sequence, PDF, and administrative path. Update generated types.
6. **Frontend context** — add business selection, active membership loading, route guards, scoped queries, realtime filters, and business-aware forms. Never silently fall back to an arbitrary workspace.
7. **Shadow verification** — compare legacy totals and reports with tenant-scoped results; test two businesses with separate fixtures and cross-tenant UUID attacks.
8. **RLS cutover** — enable tenant-aware policies only after all prior gates pass. Retain a controlled rollback plan.
9. **Acceptance** — test owner/admin/accountant/cashier/auditor roles across two businesses, including invoices, payments, receipts, inventory, expenses, journals, reports, exports, and realtime events.

## Release gates

A tenant migration is not ready to merge unless automated tests prove:

- Every business-owned row has a valid business owner.
- Every child FK resolves to a parent with the same business ID.
- Two businesses can create the same human-readable customer/product/document codes without collision.
- Cross-tenant SELECT returns no rows; cross-tenant INSERT/UPDATE/DELETE fails.
- A user with memberships in two businesses sees only the selected business in all lists, dashboards, reports, PDFs, exports, and realtime events.
- Removing/suspending a membership immediately removes access without affecting other members.
- The last active owner cannot be removed, suspended, or demoted.
- Existing legacy financial control totals remain unchanged after backfill.
- Invoice, receipt, payment, credit-note, expense, inventory, and journal RPCs remain atomic and idempotent.
- Clean migration replay, pgTAP, frontend lint/typecheck/tests/build, and Pages artifact build pass.

## Explicitly out of scope for this phase

This contract does not itself add operational `business_id` columns, change production RLS, create invitations, or claim tenant isolation. Those changes must be delivered as separately reviewable, tested migrations with their corresponding frontend and RPC updates.

<!-- CI refresh: validate the tenancy contract against the merged foundation on main. -->
