# POS transaction and settlement implementation contract

## Purpose and scope

This document defines the implementation contract for point-of-sale transactions in Audit Ledger. It is a design and acceptance artifact, not an application migration. It does not change schema, application behavior, accounting records or production data.

The POS must support quick counter sales without weakening the existing customer invoice model. Existing `invoices.customer_id`, `payments.customer_id` and `receipts.customer_id` are required relationships. POS walk-in sales therefore use a distinct sales ledger and must not create fake generic customers or relax invoice constraints.

## Existing accounting and inventory invariants

- Existing invoice issue/payment flows are not to be repurposed as anonymous POS sales.
- POS sales must be business- and location-scoped and reference products that belong to the same business.
- Inventory is location-aware. A sale must identify the stock location and must not silently decrement the legacy aggregate alone.
- Cost of goods sold uses a verified cost snapshot at posting time. Missing/unverified cost must block a stock-tracked sale or route it through an explicitly approved exception; it must never silently use zero.
- Tax must be calculated from the applicable business/product tax configuration and snapshotted on the sale line. Historical sales must not change when tax configuration changes.
- Journal entries are immutable once posted. Corrections are explicit reversals/refunds, not edits to posted sales or journal lines.
- All posting RPCs must be authenticated, active-business checked, role checked, idempotent, atomic and audited.
- Do not weaken customer invoice NOT NULL constraints or create synthetic customer accounts for walk-in sales.

## Proposed POS document model

### Sale header

Fields:
- `id`, `business_id`, location/register ID if registers are modeled, human-readable receipt number, sale timestamp, status, cashier, optional real customer ID, currency, subtotal, discount total, tax total, grand total, amount tendered, change due, idempotency key, request fingerprint, journal entry ID and timestamps.
- Status lifecycle: `draft -> posted`; posted sale is immutable. Corrections flow through refunds/void reversals with reason and authorizer.
- A walk-in sale has `customer_id = NULL` in the POS-specific sale table. It does not create or reference a placeholder customer.
- Receipt number is generated server-side, unique per business (and register if configured), using a transactional sequence. Client-generated receipt numbers are not accepted.

### Sale lines

Fields:
- business and sale IDs, product ID, description/SKU snapshot, quantity, unit price, line discount, tax code/rate/amount snapshot, net amount, gross amount, cost price snapshot, cost verification marker, and stock-tracked/service classification snapshot.
- Quantities must be positive; prices/discounts/tax must be valid and rounded according to the business currency policy.
- Product name, SKU, selling price, tax and cost snapshots are immutable after posting.
- Non-stock services may be sold without inventory movement but must follow the correct revenue/tax posting policy.

### Tender/payment lines

A sale may have multiple tender lines to support split payments:
- tender type (cash, mobile money, card, bank transfer or another configured method), amount, currency, reference/provider ID, status, provider metadata and settlement timestamp.
- Each tender must be positive and in the sale currency unless a fully specified FX settlement model is implemented.
- Cash tender may exceed the due amount and produce change. Non-cash tenders may not exceed the amount due unless an explicit provider settlement policy permits it.
- Total tender and change calculations are server-validated. The client cannot declare a sale paid by setting a status field.
- External payment provider callbacks must be signature-verified and idempotent before marking a tender settled.

## Atomic sale posting contract

Posting one sale is one database transaction. Either all effects commit, or none do:

1. Validate authenticated user, active business claim, membership status and cashier/sales permission for the business and location.
2. Lock the idempotency key and register/receipt sequence. Exact retries return the original sale; reuse with changed lines, totals, tenders or customer fails.
3. Lock all affected product/location stock balance rows in deterministic product-ID order.
4. Validate products are active and belong to the active business. Validate requested quantities against available stock after reservations/quarantine; block negative available stock unless the business has an explicit negative-stock policy.
5. Recalculate all prices, discounts, tax and totals on the server. Never trust client-submitted subtotal, tax or grand total.
6. Snapshot selling price, description, tax rate/amount, currency and verified unit cost per line.
7. Insert immutable sale and sale-line records.
8. Insert one or more tender records and validate tender allocation, change and settlement status.
9. Decrement stock at the selected location through the authoritative inventory movement/balance path. Insert immutable sale inventory movements. Do not independently mutate product aggregate and location balance without a defined projection synchronization rule.
10. Create balanced journal entry and lines:
    - Debit cash/bank/clearing accounts for settled tender amounts according to tender type.
    - Credit sales revenue for the net-of-tax sale value.
    - Credit configured tax liability for output tax.
    - Debit cost of goods sold and credit inventory for the verified cost of stock items.
    - Record change due as a cash liability/settlement adjustment according to the approved cash-control policy; do not invent a journal account.
11. Link sale, inventory movements, tenders and journal source references.
12. Write audit activity with business, actor, register/location, receipt, line and tender references.
13. Return the stable sale/receipt/journal references.

Any journal imbalance, invalid account mapping, insufficient stock, invalid tender allocation or failed inventory movement must roll back the entire transaction.

## Split tenders and cash control

- Split tender allocation must sum to the payable amount, except for cash over-tender where the excess is recorded as change due.
- A partially settled external tender cannot be treated as cash received. Pending mobile money/card authorizations remain pending until a verified provider event confirms settlement.
- Daily cash drawer opening, cash sales, cash refunds, paid-in/paid-out and closing counts must reconcile to tender movements. Drawer differences are separately recorded with reason and approval.
- Refund tender destination must follow original tender and provider refund rules; do not refund more than the refundable amount.

## Refunds, voids and reversals

- A posted sale is never deleted or edited.
- A void is allowed only before settlement/fulfilment where policy permits and must create an immutable reversal reference.
- A refund references the original sale and lines, identifies returned quantities, reason, approver and refund tenders.
- Returned physical goods are inspected. Sellable stock may be returned to available inventory; damaged/quarantined goods go to quarantine and are not available to sell.
- Refund revenue/tax and COGS/inventory journals must reverse the appropriate original values, adjusted only through documented restocking/condition policy.
- Partial refunds cannot exceed the unrefunded quantity or amount for each original line.
- Idempotency keys prevent duplicate refund, stock-restock or journal postings.

## Authorization and tenant isolation

- RLS must scope every POS header, line, tender, refund and register to one business.
- Composite foreign keys must ensure sale, product, location, customer, tender account and journal references remain within the same business.
- Cashiers may create/post sales only within permitted business locations and only for permitted product/tender actions.
- Owner/admin/accountant roles manage configuration, tax mappings, registers and refund approval policy.
- Refunds above configured thresholds require an independent approver; a cashier must not elevate their own permissions.
- Direct browser writes to posted sale, tender, stock movement and journal tables are revoked. Use narrowly scoped guarded RPCs.
- SECURITY DEFINER functions require restricted owner, fixed empty search_path, fully qualified names, narrow EXECUTE grants, and explicit identity/business/role checks.

## Accounting configuration prerequisites

Before enabling POS posting for a business, validate that required business-scoped accounts and mappings exist:
- Sales revenue by applicable revenue class.
- Output tax liability by tax category/rate where needed.
- Inventory asset.
- Cost of goods sold.
- Cash, bank, mobile-money/card clearing accounts.
- Refund/discount accounts if the chosen accounting policy uses them.

Do not silently fall back to the first matching account across businesses. Missing or ambiguous mappings block posting until an authorized administrator completes configuration.

## Acceptance test matrix

| Scenario | Expected result |
|---|---|
| Walk-in sale without a named customer | Posts with null POS customer; no fake customer or invoice is created |
| Sale references customer/product/location in another business | Rejected |
| User has no active business membership or sales permission | Denied |
| Suspended/pending member attempts to sell | Denied; no legacy global-role fallback |
| Stock is reserved, quarantined or insufficient | Available quantity enforced; no negative balance unless explicit policy |
| Two cashiers sell final units concurrently | Row locks allow no oversell |
| Same idempotency key and identical request retried | Original sale returned; no duplicate movements or journal |
| Same idempotency key with changed request | Rejected |
| Client submits incorrect totals or tax | Server recalculates; tampered values not trusted |
| Split cash + mobile-money tender | Correct tender lines and balanced journal |
| External tender remains pending | Sale/tender not falsely marked settled |
| Missing/unverified unit cost | Stock-tracked sale blocked |
| Missing business account mapping | Posting rolls back with actionable configuration error |
| Tax rate changes after sale | Historical sale tax snapshot unchanged |
| Refund exceeds original refundable line quantity/value | Rejected |
| Refund returns damaged goods | Stock goes to quarantine, not available |
| Posted sale/tender/journal is edited or deleted | Denied; reversal/refund path required |
| Journal or inventory posting fails | Entire sale transaction rolls back |
| Daily cash drawer close | Opening + inflows - outflows reconciles to closing count, differences are auditable |

## Implementation sequence

1. Confirm business-scoped register, tax and tender account configuration requirements.
2. Add POS-specific sale, line and tender schema; do not alter invoice customer constraints.
3. Implement guarded, atomic, idempotent sale posting and receipt numbering.
4. Integrate location stock balances, reservations, quarantines, immutable inventory movements and verified cost snapshots.
5. Integrate balanced revenue, tax, tender, inventory and COGS journals.
6. Build cashier POS UI with product search/barcode, cart, named customer optional, split tenders, receipt preview and print.
7. Implement refunds/voids with independent approvals, tender reversal and stock inspection.
8. Implement cash drawer opening/closing and reconciliation.
9. Complete concurrent posting, retry, RLS, cross-business, role and browser acceptance.
10. Deploy only after schema history reconciliation, staging acceptance, backup readiness and explicit production approval.

## Explicit non-goals

- Do not weaken `invoices.customer_id NOT NULL`.
- Do not generate fake generic customers for anonymous counter sales.
- Do not reuse invoice issue/payment RPCs as a workaround for POS walk-in customers.
- Do not decrement stock from the browser.
- Do not trust client totals, tax, tender status, cost or receipt numbers.
- Do not mark provider payments settled without verified provider confirmation.
- Do not apply production migrations as part of this design document.
