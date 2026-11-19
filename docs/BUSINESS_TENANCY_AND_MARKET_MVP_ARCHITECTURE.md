# Business tenancy and market-trader MVP architecture audit

## Purpose

Audit Ledger is intended to support independent small businesses as well as larger organisations. The product must not expose one business's customers, sales, payments, stock or reports to another business. The first daily workflows must also be usable by market traders who do not issue formal invoices for every counter sale.

This document records the current production-schema findings and the safe implementation sequence. It is an architecture plan, not a claim that multi-business support or the market-trader workflows are already available.

## Production schema findings

Read-only inspection of the production Supabase project on 12 November 2026 found:

- The earlier read-only inspection found RLS enabled on all 27 then-existing public tables. The subsequent accounting-ledger migration added `journal_entries` and `journal_lines` with RLS policies.
- None of the inspected business-owned tables had a `business_id`, `organization_id` or `tenant_id` ownership column; the newer journal tables are also not tenant-scoped.
- The core business tables (customers, products, invoices, payments, receipts, petty cash, inventory transactions and chart of accounts) use role-based policies, not business-membership predicates. An employee with an appropriate role can therefore see records across the current project workspace.
- `company_settings` is a single global settings row, not settings per business.
- `user_roles` assigns a role to a user globally; it is not scoped to a business.
- `petty_cash_transactions` is the existing basic income/expense record. It is not a full expense and supplier-purchase workflow, and its write policy is limited to admins/accountants.
- `payments.invoice_id` is required, so the current payment model is invoice-centred.
- The current receipt screen requires a customer and a digital signature. That is unsuitable as the only way to record a normal walk-in counter sale.
- Products have a `cost_price`, but actual purchase-cost allocation is not reliably linked to sales. The accounting screen must not infer profit from a fixed percentage.
- The accounting-ledger migration now provides `journal_entries` and `journal_lines`, with invoice and payment posting functions/triggers. These ledger tables still have no business ownership column, so they are not tenant-scoped.
- The public schema still does not provide a complete sales/POS transaction model or supplier/purchase model.

RLS being enabled is necessary but does not by itself provide tenant isolation. The policies must verify the user's membership in the business that owns each row.

## Target business model

### Core entities

- `businesses`: one independent shop, sole trader, SME or organisation workspace; includes display name, business type, country, base currency, timezone and lifecycle status.
- `business_members`: user-to-business membership with a business-scoped role and active status. A person may belong to more than one business.
- `branches` (later phase): branches or outlets under a business, with optional department/cost-centre dimensions.
- Business-owned records carry a non-null `business_id`. Branch-aware records may also carry a nullable `branch_id`.

The existing global role table should not remain the authority for day-to-day business access. Existing users and roles must be migrated into memberships for the legacy business without losing access or audit history.

### Business-owned tables to scope

At minimum: company settings, sequences, customers, products, product price history, taxes, discounts, invoices, invoice items, invoice taxes, payments, receipts, petty cash transactions, inventory transactions, chart of accounts and business audit records.

User identity and password-security tables remain user/security scoped. Platform-level administration must be separate from business membership roles.

### RLS requirements

- Every business-owned table must enforce membership in `business_id` for SELECT, INSERT, UPDATE and DELETE as appropriate.
- UPDATE policies must include both `USING` and `WITH CHECK` so a row cannot be moved to another business.
- Never trust a client-supplied business ID as proof of access.
- Business membership changes must be owner/admin controlled and audited.
- Keep RLS enabled on all exposed public tables.
- Test cross-business reads and writes using two distinct business memberships, including attempts to alter `business_id`.
- Avoid a broad `has_role()` policy that grants a user's role access to every business in the project.

## Safe migration sequence

1. **Baseline and inventory:** capture the live schema, constraints, indexes, triggers, policies, row counts and migration history. Keep production untouched during design.
2. **Create business and membership model:** add the new tables and secure membership policies. Create one legacy business for the existing workspace.
3. **Backfill ownership:** assign every existing business-owned row to the legacy business while preserving all primary keys, references, numbering, timestamps and audit history. Resolve global unique constraints before making tenant-scoped keys.
4. **Introduce scoped roles:** map existing user roles to business memberships. Keep platform administration separate.
5. **Replace RLS policies:** move from global role-only policies to business membership policies. Verify every exposed table and storage policy.
6. **Add application business context:** load the user's memberships, require an active business selection when multiple exist, and include the active business in all reads/writes. The database remains the security boundary.
7. **Validate and cut over:** run two-business isolation tests, migration replay, backup/restore checks and representative accounting workflows. Only then consider making `business_id` NOT NULL and retiring legacy policies.
8. **Production release:** use a reviewed migration with a backup and rollback/forward-repair plan. Do not run a broad backfill or policy replacement directly on production without a rehearsed staging replay and explicit release checks.

## Market-trader transaction model

The first simplified daily workflow should not be a shortcut that writes directly to receipts or petty cash. It needs a clear transaction source of truth.

### Quick sale

- A sale can be recorded without a named customer; customer selection is optional for walk-in sales.
- Product selection is optional. Users can enter a short description, quantity and amount for goods not yet in the catalogue.
- Support cash, mobile money and bank transfer, including split payments.
- Credit sales require a customer or a deliberately chosen customer account; part-payments reduce the outstanding balance.
- The sale, its payment allocations, stock movements, receipt/document and audit event must be created atomically or through idempotent backend operations.
- A retry or double tap must never duplicate a sale, payment or stock deduction.

### Expenses and purchases

- A quick expense entry should require only amount and a short description/category; payment method and supplier are optional.
- Stock purchases should record supplier (optional for informal market purchases), quantity, unit cost, payment status and stock movement.
- Expenses and stock purchases must be distinct so the cost of inventory is not incorrectly treated as an immediate operating expense.
- Reversals must retain the original transaction and record who reversed it and why.

### End-of-day view

Show clearly defined figures separately:
- sales recorded today;
- money received today, by payment method;
- credit sales and customer balances;
- expenses paid today;
- stock purchases/restocks;
- cash expected in the till, where cash movements are sufficiently captured.

Do not call the difference “profit” until cost-of-goods and all relevant expenses are recorded with a defined costing policy.

## Other target-group extensions

- **Grocery shops:** units, barcode/SKU, stock purchase, returns, expiry/batch tracking where needed, low-stock warnings and supplier balances.
- **SMEs:** invoice/quote workflows, expenses, recurring costs, supplier records, cash flow, exports and staff roles.
- **Corporate organisations:** branches, departments, approval limits, segregation of duties, audit exports and consolidated reporting.
- **Financial institutions/finance partners:** controlled read-only access, reconciliation files, traceable changes and data export controls. Do not claim regulatory compliance without a separate compliance assessment.

## Release acceptance criteria

Before enabling independent businesses in one Supabase project:

- Two test businesses can be created and assigned different members.
- A user in Business A cannot read, modify, delete or infer Business B's business-owned records through any API, RPC, view, storage bucket or export.
- A user who belongs to both businesses can switch active business without mixing cached data or writes.
- Business IDs cannot be spoofed or reassigned by a client.
- Legacy workspace rows are assigned to the legacy business and remain readable by their existing authorised users.
- All existing financial flows continue to pass tests, including partial payment, void/reversal, receipt history and stock movement.
- Clean migration replay and rollback/forward-repair procedures are tested before production release.

Before the market-trader MVP is described as available:

- A new user can record a walk-in cash sale without creating a customer or issuing a signed invoice.
- Split tender, mobile money, credit and partial payment work correctly.
- Expenses and stock purchases are distinct.
- The day summary is reconciled to the underlying transactions and explains every number.
- The workflow is usable on a small phone screen with minimal typing and clear error recovery.
